import "server-only"
import { isAdmin, type Profile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

/**
 * Who may build campaigns through the platform APIs (Dean, 2026-10-21): admins and GTM leads, on a
 * client they can edit, to start with. Widen it to everyone who can edit the client (canEdit) once
 * the builder has proved itself.
 */
export async function canBuildCampaigns(me: Profile, clientId: string) {
  if (!isAdmin(me)) return false
  const supabase = await createClient()
  const { data } = await supabase.rpc("can_edit_client", { cid: clientId })
  return Boolean(data)
}
