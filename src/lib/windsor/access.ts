import "server-only"
import { isAdmin, type Profile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

/** Who may push negative keywords (Dean, 2026-09-30): admins, GTM leads, and the specialist on the client's team. */
export async function canPushNegatives(me: Profile, clientId: string) {
  if (isAdmin(me)) return true
  if (me.role === null || me.role === "viewer") return false
  const supabase = await createClient()
  const { data } = await supabase.from("client_team").select("role").eq("client_id", clientId).eq("profile_id", me.id).eq("role", "specialist").is("removed_at", null).limit(1)
  return (data ?? []).length > 0
}
