import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { londonToday } from "@/lib/checks/periods"
import { rpcAll } from "@/lib/supabase/rpc-all"

/**
 * Live ads and ad fatigue, worked out once a day (Dean, 2026-10-15). The daily Windsor sync calls
 * snapshotAdFatigue right after it finishes; pages read the stored copy through fatigueInputs. A client with
 * no copy from the last 36 hours (new, or the morning sync failed) is worked out live instead.
 */
const MAX_AGE_HOURS = 36

/** The client's ad_fatigue_inputs rows: this morning's copy, or worked out now if there isn't a recent one. */
export async function fatigueInputs(db: SupabaseClient, clientId: string): Promise<Record<string, unknown>[]> {
  const since = new Date(Date.now() - MAX_AGE_HOURS * 3600e3).toISOString()
  const { data } = await db.from("ad_fatigue_snapshots").select("rows").eq("client_id", clientId).gte("created_at", since).order("snapshot_on", { ascending: false }).limit(1).maybeSingle()
  if (data) return data.rows as Record<string, unknown>[]
  return rpcAll(db, "ad_fatigue_inputs", { p_client: clientId })
}

/** Takes today's copy for every client (or the ones given). `admin` must be the admin client: the table is server-written. */
export async function snapshotAdFatigue(admin: SupabaseClient, clientIds?: string[]) {
  let ids = clientIds
  if (!ids) {
    const { data, error } = await admin.from("clients").select("id")
    if (error) throw new Error(`clients: ${error.message}`)
    ids = (data ?? []).map((c) => c.id as string)
  }
  const today = londonToday()
  const results: { client_id: string; ads: number; error?: string }[] = []
  for (const id of ids) {
    try {
      const rows = await rpcAll(admin, "ad_fatigue_inputs", { p_client: id })
      const through = rows.map((r) => String(r.data_through)).sort().at(-1) ?? null
      const { error } = await admin
        .from("ad_fatigue_snapshots")
        .upsert({ client_id: id, snapshot_on: today, data_through: through, ad_count: rows.length, rows, created_at: new Date().toISOString() }, { onConflict: "client_id,snapshot_on" })
      if (error) throw new Error(error.message)
      results.push({ client_id: id, ads: rows.length })
    } catch (e) {
      results.push({ client_id: id, ads: 0, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
