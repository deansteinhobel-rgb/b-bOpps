import "server-only"
import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getInsights } from "@/lib/insights/load"
import { getOverview, getPacing } from "./overview"
import { getPerformance } from "./performance"
import type { Platform } from "./types"

/**
 * Cached Windsor-derived numbers. They only change when Windsor syncs (daily) or an admin edits
 * budgets/accounts, so they're cached for 15 minutes and invalidated by tag on those events.
 *
 * SECURITY: these run with the admin client (no RLS) so the cache can be shared. Only call them
 * AFTER confirming, with the user's own RLS client, that the user can see this client (e.g. the
 * page already loaded the client row through RLS).
 */
export const windsorTag = (clientId: string) => `windsor:${clientId}`
const TTL = 900
// Bump when the shape of getOverview/getPacing changes, so an old cached copy is never read.
const SHAPE = "v3"

export const cachedOverview = (clientId: string) =>
  unstable_cache(() => getOverview(createAdminClient(), clientId), ["overview", SHAPE, clientId], { tags: ["windsor", windsorTag(clientId)], revalidate: TTL })()

export const cachedPacing = (clientId: string) =>
  unstable_cache(() => getPacing(createAdminClient(), clientId), ["pacing", SHAPE, clientId], { tags: ["windsor", windsorTag(clientId)], revalidate: TTL })()

export const cachedPerformance = (clientId: string, days: number, platform: Platform | null, campaignId: string | null = null) =>
  unstable_cache(() => getPerformance(createAdminClient(), clientId, { days, platform, campaignId }), ["performance", SHAPE, clientId, String(days), platform ?? "all", campaignId ?? ""], {
    tags: ["windsor", windsorTag(clientId)],
    revalidate: TTL,
  })()

/** The insight rules' output (Performance phase 3). The team's done / snooze / dismiss log is read live, not cached. */
export const cachedInsights = (clientId: string) =>
  unstable_cache(() => getInsights(createAdminClient(), clientId), ["insights", SHAPE, clientId], { tags: ["windsor", windsorTag(clientId)], revalidate: TTL })()
