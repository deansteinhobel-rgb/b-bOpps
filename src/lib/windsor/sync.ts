import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAccountMetrics, reconcileAccount, type Level, type MetricRow, type WindsorAccount } from "./client"

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
      // Rows are saved either way (they're still Windsor's best answer), but a gap fails the run.
      const gap = await reconcileAccount(account, opts.dateFrom, opts.dateTo, rows)
      if (gap) throw new Error(gap)
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

/** Saves rows in chunks. */
async function saveRows(db: ReturnType<typeof createAdminClient>, rows: MetricRow[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from("windsor_daily_metrics")
      .upsert(
        rows.slice(i, i + CHUNK).map((r) => ({ ...r, synced_at: new Date().toISOString() })),
        { onConflict: "platform,external_account_id,date,campaign_id,ad_id" },
      )
    if (error) throw new Error(`Saving rows: ${error.message}`)
  }
}

const monthEnd = (iso: string) => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return isoDate(d)
}
// Meta refuses start dates more than 37 months back; stay a little inside it.
const META_MONTHS = 36

/**
 * Loads an account's whole history month by month (for custom date ranges in Reporting). Each month
 * is reconciled with Windsor's account totals. Where Windsor can't give a month by ad (LinkedIn,
 * posts over 2 years old), it stores campaign totals instead, but only if that month has no ad rows
 * yet, so a day is never counted twice. Returns one line per month for the log.
 */
export async function loadHistory(opts: { clientId?: string; from: string; to: string; onMonth?: (line: string) => void }) {
  const db = createAdminClient()
  let q = db
    .from("client_platform_accounts")
    .select("client_id, platform, windsor_connector, external_account_id, conversion_fields, lead_fields, clients!inner(active)")
    .eq("active", true)
    .eq("clients.active", true)
  if (opts.clientId) q = q.eq("client_id", opts.clientId)
  const { data: accounts, error } = await q
  if (error) throw new Error(`Loading accounts: ${error.message}`)
  const failures: string[] = []
  for (const account of (accounts ?? []) as unknown as WindsorAccount[]) {
    const name = `${account.platform} ${account.external_account_id}`
    const metaStart = new Date()
    metaStart.setUTCMonth(metaStart.getUTCMonth() - META_MONTHS, 1)
    const start = account.windsor_connector === "facebook" && isoDate(metaStart) > opts.from ? isoDate(metaStart) : opts.from
    let empty = 0
    // Newest month first, so we can stop after a year with no data (the account didn't exist yet).
    const months: string[] = []
    for (let m = `${opts.to.slice(0, 7)}-01`; m >= `${start.slice(0, 7)}-01`; ) {
      months.push(m)
      const d = new Date(`${m}T00:00:00Z`)
      d.setUTCMonth(d.getUTCMonth() - 1)
      m = isoDate(d)
    }
    for (const m of months) {
      const from = m < start ? start : m
      const to = monthEnd(m) > opts.to ? opts.to : monthEnd(m)
      let level: Level = "ad"
      let rows: MetricRow[]
      try {
        rows = await fetchAccountMetrics(account, from, to, "ad")
      } catch (e) {
        const { count } = await db.from("windsor_daily_metrics").select("date", { count: "exact", head: true }).eq("platform", account.platform).eq("external_account_id", account.external_account_id).gte("date", from).lte("date", to).neq("ad_id", "")
        if (count) {
          failures.push(`${name} ${from}: ${(e as Error).message}`)
          opts.onMonth?.(`${name} ${from.slice(0, 7)} FAILED (has ad rows, not falling back): ${(e as Error).message.slice(0, 160)}`)
          continue
        }
        level = "campaign"
        try {
          rows = await fetchAccountMetrics(account, from, to, "campaign")
        } catch (e2) {
          failures.push(`${name} ${from}: ${(e2 as Error).message}`)
          opts.onMonth?.(`${name} ${from.slice(0, 7)} FAILED: ${(e2 as Error).message.slice(0, 160)}`)
          continue
        }
      }
      const spend = rows.reduce((s, r) => s + r.spend, 0)
      if (!rows.length || spend === 0) {
        opts.onMonth?.(`${name} ${from.slice(0, 7)} no data`)
        if (++empty >= 12) break
        continue
      }
      empty = 0
      await saveRows(db, rows)
      const gap = await reconcileAccount(account, from, to, rows)
      if (gap) failures.push(`${name} ${from}: ${gap}`)
      opts.onMonth?.(`${name} ${from.slice(0, 7)} ${rows.length} rows${level === "campaign" ? " (campaign totals)" : ""}${gap ? ` GAP: ${gap.slice(0, 200)}` : ""}`)
    }
  }
  return failures
}
