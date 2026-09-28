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

export function fieldsFor(account: WindsorAccount): string[] {
  const dims = DIMENSIONS[account.windsor_connector]
  if (!dims) throw new Error(`Unknown Windsor connector: ${account.windsor_connector}`)
  return [...new Set(["date", ...Object.values(dims), ...METRICS, ...account.conversion_fields, ...account.lead_fields])]
}

/** Turns Windsor rows into our rows, summing any rows that share the same key. */
export function toMetricRows(account: WindsorAccount, data: Record<string, unknown>[]): MetricRow[] {
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
      ad_name: str(r[dims.ad_name]).replace(/\s+/g, " ") || null,
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

/** One request per account, filtered to that account by Windsor (never pull all and filter). */
export async function fetchAccountMetrics(account: WindsorAccount, dateFrom: string, dateTo: string): Promise<MetricRow[]> {
  const apiKey = process.env.WINDSOR_API_KEY
  if (!apiKey) throw new Error("WINDSOR_API_KEY is not set")
  const params = new URLSearchParams({
    api_key: apiKey,
    date_from: dateFrom,
    date_to: dateTo,
    select_accounts: account.external_account_id,
    fields: fieldsFor(account).join(","),
  })
  const res = await fetch(`https://connectors.windsor.ai/${account.windsor_connector}?${params}`, { cache: "no-store" })
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>[]; error?: string } | null
  if (!res.ok || !body || !Array.isArray(body.data)) {
    throw new Error(`Windsor ${account.windsor_connector} ${account.external_account_id}: HTTP ${res.status} ${body?.error ?? ""}`.trim())
  }
  return toMetricRows(account, body.data)
}
