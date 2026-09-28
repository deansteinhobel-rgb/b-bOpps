import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAccountMetrics, type WindsorAccount } from "./client"

const CHUNK = 500

export const isoDate = (d: Date) => d.toISOString().slice(0, 10)
export const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 864e5))

export type SyncResult = { client_id: string; account: string; rows: number; error?: string }

/**
 * Pulls Windsor data for the active accounts (all clients, or one) into windsor_daily_metrics.
 * Upserts only; re-running a range replaces it with fresh numbers (catches late conversions).
 */
export async function syncWindsor(opts: { clientId?: string; accountId?: string; dateFrom: string; dateTo: string; kind: "daily" | "backfill" }) {
  const db = createAdminClient()
  let q = db
    .from("client_platform_accounts")
    .select("client_id, platform, windsor_connector, external_account_id, conversion_fields, lead_fields, clients!inner(active)")
    .eq("active", true)
    .eq("clients.active", true)
  if (opts.clientId) q = q.eq("client_id", opts.clientId)
  if (opts.accountId) q = q.eq("id", opts.accountId)
  const { data: accounts, error } = await q
  if (error) throw new Error(`Loading accounts: ${error.message}`)

  const results: SyncResult[] = []
  for (const account of (accounts ?? []) as unknown as WindsorAccount[]) {
    const { data: run } = await db
      .from("windsor_sync_runs")
      .insert({ client_id: account.client_id, kind: opts.kind, date_from: opts.dateFrom, date_to: opts.dateTo })
      .select("id")
      .single()
    try {
      const rows = await fetchAccountMetrics(account, opts.dateFrom, opts.dateTo)
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: upErr } = await db
          .from("windsor_daily_metrics")
          .upsert(
            rows.slice(i, i + CHUNK).map((r) => ({ ...r, synced_at: new Date().toISOString() })),
            { onConflict: "platform,external_account_id,date,campaign_id,ad_id" },
          )
        if (upErr) throw new Error(`Saving rows: ${upErr.message}`)
      }
      results.push({ client_id: account.client_id, account: `${account.platform} ${account.external_account_id}`, rows: rows.length })
      if (run) await db.from("windsor_sync_runs").update({ rows_upserted: rows.length, success: true, finished_at: new Date().toISOString() }).eq("id", run.id)
    } catch (e) {
      const message = (e as Error).message
      results.push({ client_id: account.client_id, account: `${account.platform} ${account.external_account_id}`, rows: 0, error: message })
      if (run) await db.from("windsor_sync_runs").update({ success: false, error: message, finished_at: new Date().toISOString() }).eq("id", run.id)
    }
  }
  return results
}
