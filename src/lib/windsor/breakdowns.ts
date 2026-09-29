import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Phase 2 breakdowns from Windsor into windsor_breakdowns (see the migration for what each kind is).
 * Reads Windsor; writes only our database (upserts, never deletes).
 */

export type Kind =
  | "search_term" | "keyword" | "impression_share"
  | "li_company" | "li_job_title" | "li_seniority" | "li_industry" | "li_job_function"
  | "meta_age_gender" | "meta_placement" | "meta_adset"
  | "ga4_landing_page"

type Account = { client_id: string; source: "google_ads" | "linkedin" | "meta" | "ga4"; connector: string; external_account_id: string; conversion_fields: string[]; lead_fields: string[] }

type Spec = {
  connector: string
  /** Daily rows, or one 30-day total per run (LinkedIn demographics: minutes per report). */
  daily: boolean
  fields: string[]
  group?: [string, string]
  dims: [string, string?]
  /** Adds the account's conversion / lead fields. */
  results: boolean
  extra?: string[]
}

const SPECS: Record<Kind, Spec> = {
  search_term: { connector: "google_ads", daily: true, fields: ["spend", "impressions", "clicks"], group: ["ad_group_id", "ad_group_name"], dims: ["search_term", "search_term_match_type"], results: true },
  keyword: { connector: "google_ads", daily: true, fields: ["spend", "impressions", "clicks"], group: ["ad_group_id", "ad_group_name"], dims: ["keyword_text", "keyword_match_type"], results: true, extra: ["quality_score"] },
  impression_share: {
    connector: "google_ads",
    daily: true,
    fields: [],
    dims: ["campaign_id"],
    results: false,
    extra: ["search_impression_share", "search_budget_lost_impression_share", "search_rank_lost_impression_share", "search_top_impression_share", "search_absolute_top_impression_share"],
  },
  li_company: { connector: "linkedin", daily: false, fields: ["spend", "impressions", "clicks"], dims: ["member_company_name"], results: true },
  li_job_title: { connector: "linkedin", daily: false, fields: ["spend", "impressions", "clicks"], dims: ["member_job_title"], results: true },
  li_seniority: { connector: "linkedin", daily: false, fields: ["spend", "impressions", "clicks"], dims: ["member_seniority"], results: true },
  li_industry: { connector: "linkedin", daily: false, fields: ["spend", "impressions", "clicks"], dims: ["member_industry"], results: true },
  li_job_function: { connector: "linkedin", daily: false, fields: ["spend", "impressions", "clicks"], dims: ["member_job_function"], results: true },
  meta_age_gender: { connector: "facebook", daily: true, fields: ["spend", "impressions", "clicks"], group: ["adset_id", "adset_name"], dims: ["age", "gender"], results: true },
  meta_placement: { connector: "facebook", daily: true, fields: ["spend", "impressions", "clicks"], dims: ["publisher_platform", "platform_position"], results: true },
  meta_adset: { connector: "facebook", daily: true, fields: ["spend", "impressions", "clicks"], group: ["adset_id", "adset_name"], dims: ["adset_id"], results: false, extra: ["reach", "frequency", "adset_learning_stage_info"] },
  ga4_landing_page: {
    connector: "googleanalytics4",
    daily: true,
    fields: [],
    dims: ["landing_page", "session_source_medium"],
    results: false,
    extra: ["campaign", "sessions", "engaged_sessions", "engagement_rate", "conversions", "bounce_rate", "average_session_duration"],
  },
}
export const DAILY_KINDS = (Object.keys(SPECS) as Kind[]).filter((k) => SPECS[k].daily)
export const LINKEDIN_KINDS = (Object.keys(SPECS) as Kind[]).filter((k) => !SPECS[k].daily)
const SOURCE_OF: Record<string, Account["source"]> = { google_ads: "google_ads", linkedin: "linkedin", facebook: "meta", googleanalytics4: "ga4" }

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0)
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())

async function windsor(connector: string, account: string, fields: string[], from: string, to: string) {
  const params = new URLSearchParams({ api_key: process.env.WINDSOR_API_KEY ?? "", date_from: from, date_to: to, select_accounts: account, fields: [...new Set(fields)].join(",") })
  const res = await fetch(`https://connectors.windsor.ai/${connector}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(280_000) })
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>[]; error?: string } | null
  if (!res.ok || !Array.isArray(body?.data)) throw new Error(`Windsor ${connector}: HTTP ${res.status} ${String(body?.error ?? "").slice(0, 200)}`)
  return body.data
}

/** The accounts a kind applies to: ad accounts from client_platform_accounts, GA4 from clients.ga4_property_id. */
async function accountsFor(kind: Kind, clientId?: string): Promise<Account[]> {
  const db = createAdminClient()
  const spec = SPECS[kind]
  if (spec.connector === "googleanalytics4") {
    let q = db.from("clients").select("id, ga4_property_id").eq("active", true).not("ga4_property_id", "is", null)
    if (clientId) q = q.eq("id", clientId)
    const { data } = await q
    return (data ?? []).map((c) => ({ client_id: c.id, source: "ga4", connector: "googleanalytics4", external_account_id: c.ga4_property_id!, conversion_fields: [], lead_fields: [] }))
  }
  let q = db.from("client_platform_accounts").select("client_id, windsor_connector, external_account_id, conversion_fields, lead_fields, clients!inner(active)").eq("active", true).eq("windsor_connector", spec.connector).eq("clients.active", true)
  if (clientId) q = q.eq("client_id", clientId)
  const { data } = await q
  return (data ?? []).map((a) => ({ client_id: a.client_id, source: SOURCE_OF[a.windsor_connector], connector: a.windsor_connector, external_account_id: a.external_account_id, conversion_fields: a.conversion_fields ?? [], lead_fields: a.lead_fields ?? [] }))
}

/** Pulls one kind for one account over a date range and upserts it. Returns the rows written. */
export async function syncBreakdown(kind: Kind, account: Account, from: string, to: string) {
  const spec = SPECS[kind]
  const fields = [
    ...(spec.daily ? ["date"] : []),
    "campaign_id",
    "campaign",
    ...(spec.group ?? []),
    ...(spec.dims.filter(Boolean) as string[]),
    ...spec.fields,
    ...(spec.results ? [...account.conversion_fields, ...account.lead_fields] : []),
    ...(spec.extra ?? []),
  ].filter((f) => !(spec.connector === "googleanalytics4" && (f === "campaign_id" || f === "campaign")))
  const data = await windsor(spec.connector, account.external_account_id, spec.connector === "googleanalytics4" ? [...fields, "campaign"] : fields, from, to)

  const byKey = new Map<string, Record<string, unknown>>()
  for (const r of data) {
    const row = {
      client_id: account.client_id,
      source: account.source,
      external_account_id: account.external_account_id,
      kind,
      date: spec.daily ? str(r.date) : to,
      campaign_id: spec.connector === "googleanalytics4" ? "" : str(r.campaign_id),
      campaign_name: spec.connector === "googleanalytics4" ? str(r.campaign) || null : str(r.campaign) || null,
      group_id: spec.group ? str(r[spec.group[0]]) : "",
      group_name: spec.group ? str(r[spec.group[1]]) || null : null,
      dim1: str(r[spec.dims[0]]).slice(0, 500),
      dim2: spec.dims[1] ? str(r[spec.dims[1]]).slice(0, 200) : "",
      spend: num(r.spend),
      impressions: Math.round(num(r.impressions)),
      clicks: Math.round(num(r.clicks)),
      conversions: spec.results ? account.conversion_fields.reduce((s, f) => s + num(r[f]), 0) : spec.connector === "googleanalytics4" ? num(r.conversions) : 0,
      leads: spec.results ? account.lead_fields.reduce((s, f) => s + num(r[f]), 0) : 0,
      extra: spec.extra ? Object.fromEntries(spec.extra.map((f) => [f, r[f] ?? null])) : null,
      synced_at: new Date().toISOString(),
    }
    if (!row.date || (!row.dim1 && kind !== "impression_share")) continue
    const key = [row.date, row.campaign_id, row.group_id, row.dim1, row.dim2].join("|")
    const prev = byKey.get(key)
    if (prev) {
      for (const k of ["spend", "impressions", "clicks", "conversions", "leads"] as const) prev[k] = (prev[k] as number) + (row[k] as number)
    } else byKey.set(key, row)
  }
  const rows = [...byKey.values()]
  const db = createAdminClient()
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("windsor_breakdowns").upsert(rows.slice(i, i + 500), { onConflict: "client_id,source,external_account_id,kind,date,campaign_id,group_id,dim1,dim2" })
    if (error) throw new Error(`Saving ${kind}: ${error.message}`)
  }
  await db.from("breakdown_sync_state").upsert({ client_id: account.client_id, source: account.source, external_account_id: account.external_account_id, kind, synced_through: to, synced_at: new Date().toISOString(), error: null })
  return rows.length
}

/** [from, to] split into windows of at most `days` days. */
function windows(from: string, to: string, days: number): [string, string][] {
  const out: [string, string][] = []
  const day = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)
  for (let start = from; start <= to; start = day(start, days)) {
    const end = day(start, days - 1)
    out.push([start, end < to ? end : to])
  }
  return out
}

/** Every daily kind for every account over [from, to] (daily job: the last 3 days; backfill: longer). */
export async function syncDailyBreakdowns(opts: { from: string; to: string; clientId?: string; kinds?: Kind[] }) {
  const results: { kind: Kind; account: string; rows?: number; error?: string }[] = []
  for (const kind of opts.kinds ?? DAILY_KINDS) {
    for (const a of await accountsFor(kind, opts.clientId)) {
      try {
        // Meta refuses big breakdown requests ("reduce the amount of data"): go a week at a time.
        let rows = 0
        for (const [from, to] of windows(opts.from, opts.to, SPECS[kind].connector === "facebook" ? 7 : 31)) rows += await syncBreakdown(kind, a, from, to)
        results.push({ kind, account: a.external_account_id, rows })
      } catch (e) {
        await createAdminClient().from("breakdown_sync_state").upsert({ client_id: a.client_id, source: a.source, external_account_id: a.external_account_id, kind, error: (e as Error).message.slice(0, 300), synced_at: new Date().toISOString() })
        results.push({ kind, account: a.external_account_id, error: (e as Error).message })
      }
    }
  }
  return results
}

/**
 * The stalest LinkedIn 30-day breakdown (each takes 2-4 minutes at Windsor), for the weekly job.
 * Returns null when every one is under 6 days old.
 */
export async function syncNextLinkedInBreakdown(to: string) {
  const db = createAdminClient()
  const { data: state } = await db.from("breakdown_sync_state").select("client_id, external_account_id, kind, synced_at").eq("source", "linkedin")
  const jobs: { kind: Kind; account: Account; last: string }[] = []
  for (const kind of LINKEDIN_KINDS) {
    for (const a of await accountsFor(kind)) {
      const s = state?.find((x) => x.client_id === a.client_id && x.external_account_id === a.external_account_id && x.kind === kind)
      jobs.push({ kind, account: a, last: s?.synced_at ?? "" })
    }
  }
  const next = jobs.sort((a, b) => a.last.localeCompare(b.last))[0]
  if (!next || (next.last && Date.now() - Date.parse(next.last) < 6 * 864e5)) return null
  const from = new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10)
  try {
    return { kind: next.kind, account: next.account.external_account_id, rows: await syncBreakdown(next.kind, next.account, from, to) }
  } catch (e) {
    await db.from("breakdown_sync_state").upsert({ client_id: next.account.client_id, source: "linkedin", external_account_id: next.account.external_account_id, kind: next.kind, error: (e as Error).message.slice(0, 300), synced_at: new Date().toISOString() })
    return { kind: next.kind, account: next.account.external_account_id, error: (e as Error).message }
  }
}
