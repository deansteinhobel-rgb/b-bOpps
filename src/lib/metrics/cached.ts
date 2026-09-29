import "server-only"
import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getInsights, loadInsightInputs } from "@/lib/insights/load"
import { codeFingerprint, RULES_FINGERPRINT } from "@/lib/insights/rules"
import { getOverview, getPacing } from "./overview"
import { getPerformance } from "./performance"
import type { Platform } from "./types"

/**
 * Cached Windsor-derived numbers. They only change when data syncs or an admin edits budgets/accounts,
 * so they're cached for 15 minutes and invalidated by tag on those events. The key also includes:
 *   - the client's data stamp (latest sync run, breakdown pull or status check), so a sync run from
 *     the command line, which can't invalidate tags, still shows up straight away;
 *   - a fingerprint of the code that computes them, so a code change never shows an old result.
 *
 * SECURITY: these run with the admin client (no RLS) so the cache can be shared. Only call them
 * AFTER confirming, with the user's own RLS client, that the user can see this client (e.g. the
 * page already loaded the client row through RLS).
 */
export const windsorTag = (clientId: string) => `windsor:${clientId}`
const TTL = 900
// Bump when the shape of what's cached changes, so an old cached copy is never read.
const SHAPE = "v5"
const CODE = codeFingerprint(getOverview, getPacing, getPerformance, loadInsightInputs, getInsights)

/** When the client's synced data last changed (one small query, outside the cache). */
async function stamp(clientId: string) {
  const { data } = await createAdminClient().rpc("client_data_stamp", { p_client: clientId })
  return String(data ?? "none")
}
const opts = (clientId: string) => ({ tags: ["windsor", windsorTag(clientId)], revalidate: TTL })

export const cachedOverview = async (clientId: string) =>
  unstable_cache(() => getOverview(createAdminClient(), clientId), ["overview", SHAPE, CODE, clientId, await stamp(clientId)], opts(clientId))()

export const cachedPacing = async (clientId: string) =>
  unstable_cache(() => getPacing(createAdminClient(), clientId), ["pacing", SHAPE, CODE, clientId, await stamp(clientId)], opts(clientId))()

export const cachedPerformance = async (clientId: string, days: number, platform: Platform | null, campaignId: string | null = null) =>
  unstable_cache(() => getPerformance(createAdminClient(), clientId, { days, platform, campaignId }), ["performance", SHAPE, CODE, clientId, await stamp(clientId), String(days), platform ?? "all", campaignId ?? ""], opts(clientId))()

/** The insight rules' output (Performance phase 3). The team's done / snooze / dismiss log is read live, not cached. */
export const cachedInsights = async (clientId: string) =>
  unstable_cache(() => getInsights(createAdminClient(), clientId), ["insights", SHAPE, CODE, RULES_FINGERPRINT, clientId, await stamp(clientId)], opts(clientId))()
