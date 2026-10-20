import type { Db } from "@/lib/supabase/db"
import type { Platform } from "./types"

export type DataRange = { platform: Platform; external_account_id: string; data_from: string; data_through: string }

/**
 * The first and last synced day per ad account for one client (SQL `client_data_range`, 2026-10-15). Replaces
 * reads of the account_data_range view, which scanned the client's whole history (DNSFilter goes back to 2018).
 * RLS applies: a client the caller can't see returns no rows.
 */
export async function dataRanges(db: Db, clientId: string): Promise<{ data: DataRange[] | null; error: { message: string } | null }> {
  const { data, error } = await db.rpc("client_data_range", { p_client: clientId })
  return { data: (data as DataRange[] | null) ?? null, error }
}
