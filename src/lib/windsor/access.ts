import "server-only"
import { canEdit, type Profile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

/** Who may push negative keywords (Dean, 2026-10-15): every role that runs features, on a client they can edit. */
export async function canPushNegatives(me: Profile, clientId: string) {
  if (!canEdit(me)) return false
  const supabase = await createClient()
  const { data } = await supabase.rpc("can_edit_client", { cid: clientId })
  return Boolean(data)
}

/** Who may create paused search ads and pause ads from a sprint test (Dean, 2026-10-15): the same people as negatives. */
export const canWriteGoogleAds = canPushNegatives
