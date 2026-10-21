import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson, type Db } from "@/lib/supabase/db"
import type { Before, EditStore } from "./edit"
import type { LinkedInCampaign } from "./linkedin-read"

// Shared by the campaign builder's edits and the exclusions on Recommendations: whether a LinkedIn
// account and campaign are the client's (from our own data, never the browser) and the write log.

export async function linkedInAccount(clientId: string, accountId: string) {
  if (!/^\d+$/.test(accountId)) return false
  const { data } = await createAdminClient().from("client_platform_accounts").select("external_account_id").eq("client_id", clientId).eq("platform", "linkedin").eq("external_account_id", accountId).eq("active", true).maybeSingle()
  return Boolean(data)
}

/** The client's LinkedIn campaign: in the daily status sync on a mapped account, or built by the app. */
export async function linkedInCampaignOf(clientId: string, campaignId: string): Promise<{ accountId: string; name: string; status: string | null } | null> {
  if (!/^\d+$/.test(campaignId)) return null
  const db = createAdminClient()
  const { data } = await db.from("campaign_statuses").select("external_account_id, campaign_name, status").eq("client_id", clientId).eq("platform", "linkedin").eq("campaign_id", campaignId).maybeSingle()
  if (data && (await linkedInAccount(clientId, data.external_account_id))) return { accountId: data.external_account_id, name: data.campaign_name ?? campaignId, status: data.status }
  // A campaign the app built may not be in the daily sync yet.
  const { data: built } = await db.from("campaign_builds").select("external_account_id, name, created_ids").eq("client_id", clientId).eq("platform", "linkedin").contains("created_ids", { campaign: campaignId }).maybeSingle()
  if (built) return { accountId: built.external_account_id, name: built.name, status: null }
  // The status sync doesn't list every campaign (Filevine's biggest spender was missing, 2026-10-21):
  // a campaign with recent metrics on one of the client's mapped accounts is the client's too.
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  const { data: seen } = await db.from("windsor_daily_metrics").select("external_account_id, campaign_name").eq("client_id", clientId).eq("platform", "linkedin").eq("campaign_id", campaignId).gte("date", since).order("date", { ascending: false }).limit(1).maybeSingle()
  if (seen && (await linkedInAccount(clientId, seen.external_account_id))) return { accountId: seen.external_account_id, name: seen.campaign_name ?? campaignId, status: null }
  return null
}

export const beforeOf = (r: LinkedInCampaign, withTargeting = false): NonNullable<Before> => ({
  name: r.name,
  status: r.status,
  dailyBudget: r.dailyBudget,
  start: r.start,
  startMs: r.startMs,
  end: r.end,
  ...(withTargeting ? { targetingCriteria: r.targetingCriteria } : {}),
})

/** platform_write_log, written as the person (createAdminClient(me.id)) so the change log names them. */
export function editStore(db: Db): EditStore {
  return {
    async log(row) {
      const { data, error } = await db.from("platform_write_log").insert({ ...row, payload: toJson(row.payload), previous: toJson(row.previous) }).select("id").single()
      return error || !data ? { error: error?.message ?? "no row" } : { id: data.id }
    },
    async finishLog(id, v) {
      await db.from("platform_write_log").update({ success: v.success, response: toJson(v.response), completed_at: new Date().toISOString() }).eq("id", id)
    },
  }
}

export const linkedInNotConnected = (e: unknown) => /isn't connected|isn't set/.test((e as Error).message)
