import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

export type Person = {
  /** Notion user ID, or null if we don't know it. Actions are assigned by this. */
  notionUserId: string | null
  profileId: string | null
  email: string
  name: string
  onTeam: boolean
}

/**
 * Everyone who can own an action: signed-in profiles plus invited people who haven't signed in yet.
 * The client's own team comes first. RLS applies.
 */
export async function peopleForClient(supabase: SupabaseClient, clientId: string): Promise<Person[]> {
  const [{ data: profiles }, { data: invites }, { data: team }, { data: teamInvites }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, notion_user_id").not("role", "is", null),
    supabase.from("team_invites").select("email, full_name, notion_user_id"),
    supabase.from("client_team").select("profile_id").eq("client_id", clientId).is("removed_at", null),
    supabase.from("client_team_invites").select("email").eq("client_id", clientId).is("removed_at", null),
  ])
  const teamProfiles = new Set((team ?? []).map((t) => t.profile_id))
  const teamEmails = new Set((teamInvites ?? []).map((t) => t.email))
  const byEmail = new Map<string, Person>()
  for (const i of invites ?? []) {
    byEmail.set(i.email, { notionUserId: i.notion_user_id, profileId: null, email: i.email, name: i.full_name ?? i.email, onTeam: teamEmails.has(i.email) })
  }
  for (const p of profiles ?? []) {
    const prev = byEmail.get(p.email)
    byEmail.set(p.email, {
      notionUserId: p.notion_user_id ?? prev?.notionUserId ?? null,
      profileId: p.id,
      email: p.email,
      name: p.full_name ?? prev?.name ?? p.email,
      onTeam: teamProfiles.has(p.id) || teamEmails.has(p.email),
    })
  }
  return [...byEmail.values()].sort((a, b) => Number(b.onTeam) - Number(a.onTeam) || a.name.localeCompare(b.name))
}
