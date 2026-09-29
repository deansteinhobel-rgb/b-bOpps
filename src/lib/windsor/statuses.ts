import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { recordStatusChange } from "./changes"

/**
 * Current campaign status per platform, from Windsor, into campaign_statuses (upserts only).
 * Asks for the last 14 days so campaigns that stopped recently are included.
 */
const FIELD: Record<string, string> = { google_ads: "campaign_status", linkedin: "campaign_status", facebook: "campaign_effective_status" }

export async function syncCampaignStatuses(opts: { clientId?: string; to: string }) {
  const db = createAdminClient()
  let q = db.from("client_platform_accounts").select("client_id, platform, windsor_connector, external_account_id, clients!inner(active)").eq("active", true).eq("clients.active", true)
  if (opts.clientId) q = q.eq("client_id", opts.clientId)
  const { data: accounts } = await q
  const from = new Date(Date.parse(opts.to) - 13 * 864e5).toISOString().slice(0, 10)
  const results: { account: string; rows?: number; error?: string }[] = []
  for (const a of accounts ?? []) {
    const field = FIELD[a.windsor_connector]
    if (!field) continue
    try {
      const params = new URLSearchParams({ api_key: process.env.WINDSOR_API_KEY ?? "", date_from: from, date_to: opts.to, select_accounts: a.external_account_id, fields: `campaign_id,campaign,${field}` })
      const res = await fetch(`https://connectors.windsor.ai/${a.windsor_connector}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(120_000) })
      const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>[] } | null
      if (!res.ok || !Array.isArray(body?.data)) throw new Error(`Windsor ${a.windsor_connector}: HTTP ${res.status}`)
      const byId = new Map<string, Record<string, unknown>>()
      for (const r of body.data) if (r.campaign_id && r[field]) byId.set(String(r.campaign_id), r)
      const rows = [...byId.values()].map((r) => ({
        client_id: a.client_id,
        platform: a.platform,
        external_account_id: a.external_account_id,
        campaign_id: String(r.campaign_id),
        campaign_name: r.campaign ? String(r.campaign) : null,
        status: String(r[field]).toUpperCase(),
        checked_at: new Date().toISOString(),
      }))
      // LinkedIn has no change log: record status changes we see between checks (Google and Meta log them).
      if (a.platform === "linkedin" && rows.length) {
        const { data: before } = await db.from("campaign_statuses").select("campaign_id, status").eq("platform", "linkedin").eq("external_account_id", a.external_account_id)
        const was = new Map((before ?? []).map((b) => [b.campaign_id as string, b.status as string]))
        for (const r of rows) {
          const prev = was.get(r.campaign_id)
          if (prev && prev !== r.status) await recordStatusChange({ client_id: a.client_id, platform: "linkedin", external_account_id: a.external_account_id, campaign_id: r.campaign_id, campaign_name: r.campaign_name, from: prev, to: r.status })
        }
      }
      if (rows.length) {
        const { error } = await db.from("campaign_statuses").upsert(rows, { onConflict: "platform,external_account_id,campaign_id" })
        if (error) throw new Error(error.message)
      }
      results.push({ account: `${a.windsor_connector} ${a.external_account_id}`, rows: rows.length })
    } catch (e) {
      results.push({ account: `${a.windsor_connector} ${a.external_account_id}`, error: (e as Error).message })
    }
  }
  return results
}
