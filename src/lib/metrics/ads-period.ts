import type { SupabaseClient } from "@supabase/supabase-js"
import { rpcAll } from "@/lib/supabase/rpc-all"
import type { AdStat } from "./ads"
import type { Platform } from "./types"

const num = (v: unknown) => Number(v ?? 0)

/** Every ad's totals over a period. */
export async function adsForPeriod(supabase: SupabaseClient, clientId: string, from: string, to: string): Promise<AdStat[]> {
  const rows = await rpcAll(supabase, "ad_totals", { p_client: clientId, p_from: from, p_to: to })
  return rows.map((r) => ({
    platform: r.platform as Platform,
    external_account_id: String(r.external_account_id),
    ad_id: String(r.ad_id),
    ad_name: (r.ad_name as string | null) ?? null,
    campaign_id: r.campaign_id === null || r.campaign_id === undefined ? null : String(r.campaign_id),
    campaign_name: (r.campaign_name as string | null) ?? null,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
    leads: num(r.leads),
  }))
}
