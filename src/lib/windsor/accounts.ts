import "server-only"
import type { Platform } from "./client"

export const CONNECTORS: { connector: string; platform: Platform }[] = [
  { connector: "linkedin", platform: "linkedin" },
  { connector: "google_ads", platform: "google_ads" },
  { connector: "facebook", platform: "meta" },
  { connector: "reddit", platform: "reddit" },
]

/** Default conversion/lead fields per connector (Phase 0 scan; CLAUDE.md "Windsor field mapping"). */
export const DEFAULT_FIELDS: Record<string, { conversion_fields: string[]; lead_fields: string[] }> = {
  linkedin: { conversion_fields: ["externalwebsiteconversions"], lead_fields: ["oneclickleads"] },
  google_ads: { conversion_fields: ["conversions"], lead_fields: [] },
  facebook: { conversion_fields: [], lead_fields: ["actions_lead"] },
  // Reddit (DNSFilter, Dean 2026-10-15: "cost per result or view through"): lead and sign-up
  // conversions, click-through and view-through. Page visits and view content are far too loose.
  reddit: { conversion_fields: ["conversion_lead_clicks", "conversion_sign_up_clicks", "conversion_lead_views", "conversion_sign_up_views"], lead_fields: [] },
}

export type WindsorAccountOption = { connector: string; platform: Platform; account_id: string; account_name: string }

/** Accounts connected to our Windsor key, for the admin "map account" picker. */
export async function listWindsorAccounts(): Promise<WindsorAccountOption[]> {
  const apiKey = process.env.WINDSOR_API_KEY
  if (!apiKey) throw new Error("WINDSOR_API_KEY is not set")
  const lists = await Promise.all(
    CONNECTORS.map(async ({ connector, platform }) => {
      const params = new URLSearchParams({ datasource: connector, api_key: apiKey })
      const res = await fetch(`https://onboard.windsor.ai/api/common/ds-accounts?${params}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) })
      // A bad key or an outage must not look like "no accounts".
      if (!res.ok) throw new Error(`Windsor accounts (${connector}): HTTP ${res.status}`)
      const body = (await res.json().catch(() => [])) as { account_id: string | number; account_name: string }[] | { data?: unknown[] }
      const rows = (Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? [])) as { account_id: string | number; account_name: string }[]
      return rows.map((r) => ({ connector, platform, account_id: String(r.account_id), account_name: r.account_name }))
    }),
  )
  return lists.flat()
}
