import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Calls a set-returning SQL function and reads every row. The API returns at most 1,000 rows per
 * request, so a plain .rpc() quietly truncates big results (e.g. every ad ever, campaigns × days).
 */
export async function rpcAll<T = Record<string, unknown>>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.rpc(fn, args).range(offset, offset + 999)
    if (error) throw new Error(`${fn}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}
