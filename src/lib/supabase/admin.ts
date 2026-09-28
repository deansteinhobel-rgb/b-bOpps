import "server-only"
import { createClient } from "@supabase/supabase-js"

/**
 * Supabase client with the secret key. BYPASSES RLS. Server-side only (sync jobs, the Notion write
 * log). Never use it to answer a user's request for data they could read themselves.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
