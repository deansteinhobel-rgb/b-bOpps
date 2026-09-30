import "server-only"

/**
 * Windsor.ai REST client. Server-side only. The UI never calls Windsor: sync jobs write to
 * windsor_daily_metrics and pages read from there.
 */

export type Platform = "linkedin" | "google_ads" | "meta"

// Confirmed in Phase 0 (see CLAUDE.md "Windsor field mapping").
const DIMENSIONS: Record<string, { campaign_id: string; campaign_name: string; ad_id: string; ad_name: string }> = {
  linkedin: { campaign_id: "campaign_id", campaign_name: "campaign", ad_id: "creative_id", ad_name: "sponsored_creative_content_title" },
  google_ads: { campaign_id: "campaign_id", campaign_name: "campaign", ad_id: "ad_id", ad_name: "ad_name" },
  facebook: { campaign_id: "campaign_id", campaign_name: "campaign", ad_id: "ad_id", ad_name: "ad_name" },
}
const METRICS = ["spend", "impressions", "clicks"] as const

export type WindsorAccount = {
  client_id: string
  platform: Platform
  windsor_connector: string
  external_account_id: string
  conversion_fields: string[]
  lead_fields: string[]
}

export type MetricRow = {
  client_id: string
  platform: Platform
  external_account_id: string
  date: string
  campaign_id: string
  campaign_name: string | null
  ad_id: string
  ad_name: string | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
  leads: number
  raw: Record<string, unknown>
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0)
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())

/**
 * The numbers request. Ad names come in a separate request (`nameFieldsFor`): asking for the ad name
 * together with conversions and leads makes Windsor's LinkedIn connector silently drop rows (Camber,
 * 22-23 Sept 2026: $295 of spend missing in one week), while any two of the three are fine.
 */
export function fieldsFor(account: WindsorAccount): string[] {
  const dims = DIMENSIONS[account.windsor_connector]
  if (!dims) throw new Error(`Unknown Windsor connector: ${account.windsor_connector}`)
  return [...new Set(["date", dims.campaign_id, dims.campaign_name, dims.ad_id, ...METRICS, ...account.conversion_fields, ...account.lead_fields])]
}

export function nameFieldsFor(account: WindsorAccount): string[] {
  const dims = DIMENSIONS[account.windsor_connector]
  return [dims.ad_id, dims.ad_name]
}

/** Turns Windsor rows into our rows, summing any rows that share the same key. */
export function toMetricRows(account: WindsorAccount, data: Record<string, unknown>[], adNames = new Map<string, string>()): MetricRow[] {
  const dims = DIMENSIONS[account.windsor_connector]
  const byKey = new Map<string, MetricRow>()
  for (const r of data) {
    const row: MetricRow = {
      client_id: account.client_id,
      platform: account.platform,
      external_account_id: account.external_account_id,
      date: str(r.date),
      campaign_id: str(r[dims.campaign_id]),
      campaign_name: str(r[dims.campaign_name]) || null,
      ad_id: str(r[dims.ad_id]),
      ad_name: (adNames.get(str(r[dims.ad_id])) ?? str(r[dims.ad_name])).replace(/\s+/g, " ").trim() || null,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      conversions: account.conversion_fields.reduce((s, f) => s + num(r[f]), 0),
      leads: account.lead_fields.reduce((s, f) => s + num(r[f]), 0),
      raw: r,
    }
    if (!row.date) continue
    const key = `${row.date}|${row.campaign_id}|${row.ad_id}`
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, row)
      continue
    }
    for (const m of ["spend", "impressions", "clicks", "conversions", "leads"] as const) prev[m] += row[m]
  }
  return [...byKey.values()]
}

async function windsorGet(account: WindsorAccount, dateFrom: string, dateTo: string, fields: string[]) {
  const apiKey = process.env.WINDSOR_API_KEY
  if (!apiKey) throw new Error("WINDSOR_API_KEY is not set")
  const params = new URLSearchParams({
    api_key: apiKey,
    date_from: dateFrom,
    date_to: dateTo,
    select_accounts: account.external_account_id,
    fields: fields.join(","),
  })
  const res = await fetch(`https://connectors.windsor.ai/${account.windsor_connector}?${params}`, { cache: "no-store" })
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>[]; error?: string } | null
  if (!res.ok || !body || !Array.isArray(body.data)) {
    throw new Error(`Windsor ${account.windsor_connector} ${account.external_account_id}: HTTP ${res.status} ${body?.error ?? ""}`.trim())
  }
  return body.data
}

/** One request per account, filtered to that account by Windsor (never pull all and filter). */
export async function fetchAccountMetrics(account: WindsorAccount, dateFrom: string, dateTo: string): Promise<MetricRow[]> {
  const dims = DIMENSIONS[account.windsor_connector]
  const [data, names] = await Promise.all([
    windsorGet(account, dateFrom, dateTo, fieldsFor(account)),
    windsorGet(account, dateFrom, dateTo, nameFieldsFor(account)).catch(() => []), // names are cosmetic
  ])
  const adNames = new Map<string, string>()
  for (const n of names) if (str(n[dims.ad_id]) && str(n[dims.ad_name])) adNames.set(str(n[dims.ad_id]), str(n[dims.ad_name]))
  return toMetricRows(account, data, adNames)
}

/**
 * Checks the rows against Windsor's account totals by day, so a request that quietly drops rows
 * shows up as a failed sync instead of lower numbers. Returns a description of the gaps, or null.
 */
export async function reconcileAccount(account: WindsorAccount, dateFrom: string, dateTo: string, rows: MetricRow[]): Promise<string | null> {
  const totals = await windsorGet(account, dateFrom, dateTo, ["date", ...METRICS])
  const ours = new Map<string, { spend: number; impressions: number }>()
  for (const r of rows) {
    const d = ours.get(r.date) ?? { spend: 0, impressions: 0 }
    d.spend += r.spend
    d.impressions += r.impressions
    ours.set(r.date, d)
  }
  const gaps: string[] = []
  for (const t of totals) {
    const date = str(t.date)
    const want = { spend: num(t.spend), impressions: num(t.impressions) }
    const got = ours.get(date) ?? { spend: 0, impressions: 0 }
    const spendOff = Math.abs(want.spend - got.spend) > Math.max(1, want.spend * 0.01)
    const impOff = Math.abs(want.impressions - got.impressions) > Math.max(10, want.impressions * 0.01)
    if (spendOff || impOff) gaps.push(`${date} spend ${got.spend.toFixed(2)} of ${want.spend.toFixed(2)}, impressions ${got.impressions} of ${want.impressions}`)
  }
  return gaps.length ? `Rows don't add up to Windsor's account totals: ${gaps.join("; ")}` : null
}
