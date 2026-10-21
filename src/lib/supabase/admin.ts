import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

/**
 * Supabase client with the secret key. BYPASSES RLS. Server-side only (sync jobs, the Notion write
 * log). Never use it to answer a user's request for data they could read themselves.
 *
 * Pass `actorId` (the signed-in person's profile id) when the server writes on someone's behalf: the
 * change log records them as the person who made the change (`x-lumaux-actor`, read by the
 * `change_actor()` SQL function). Without it, writes count as the app's own work and aren't logged.
 */
export function createAdminClient(actorId?: string) {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(actorId ? { global: { headers: { "x-lumaux-actor": actorId } } } : {}),
  })
}
