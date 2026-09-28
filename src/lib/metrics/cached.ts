import "server-only"
import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getOverview, getPacing } from "./overview"

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

export const cachedOverview = (clientId: string) =>
  unstable_cache(() => getOverview(createAdminClient(), clientId), ["overview", clientId], { tags: ["windsor", windsorTag(clientId)], revalidate: TTL })()

export const cachedPacing = (clientId: string) =>
  unstable_cache(() => getPacing(createAdminClient(), clientId), ["pacing", clientId], { tags: ["windsor", windsorTag(clientId)], revalidate: TTL })()
