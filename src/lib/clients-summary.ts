import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { currentPeriods } from "@/lib/checks/periods"
import { isRedNotActioned } from "@/lib/checks/runs"
import { cachedPacing } from "@/lib/metrics/cached"
import type { PlatformPacing } from "@/lib/metrics/overview"
import { CLOSED_STATUSES, PROP } from "@/lib/notion/config"

export type ClientCard = {
  id: string
  name: string
  slug: string
  pacing: PlatformPacing[]
  worstPacing: PlatformPacing["status"] | null
  dataThrough: string | null
  week: { done: number; total: number } | null
  openActions: number
  redsNotActioned: number
  team: string[]
}

const SEVERITY = { red: 3, amber: 2, green: 1, no_budget: 0 } as const

/** One card per client the user can see (RLS). "Mine" = clients the user is on the team of. */
export async function clientCards(supabase: SupabaseClient, opts: { profileId: string; onlyMine: boolean }): Promise<ClientCard[]> {
  const { weekly } = currentPeriods()
  const [{ data: clients }, { data: mine }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, slug, client_team(profile_id, removed_at, profiles(full_name, email)), client_team_invites(email, removed_at, team_invites(full_name))")
      .eq("active", true)
      .is("client_team.removed_at", null)
      .is("client_team_invites.removed_at", null)
      .order("name"),
    supabase.from("client_team").select("client_id").eq("profile_id", opts.profileId).is("removed_at", null),
  ])
  const mineIds = new Set((mine ?? []).map((m) => m.client_id))
  const list = (clients ?? []).filter((c) => !opts.onlyMine || mineIds.has(c.id))

  return Promise.all(
    list.map(async (c) => {
      const [pacing, { data: run }, { data: actions }, { data: reds }] = await Promise.all([
        cachedPacing(c.id), // clients list came through RLS
        supabase.from("check_runs").select("id, check_results(status)").eq("client_id", c.id).eq("cadence", "weekly").eq("period_start", weekly.start).maybeSingle(),
        supabase.from("notion_pages_mirror").select("properties").eq("client_id", c.id).eq("page_type", "action").eq("in_trash", false),
        supabase.from("check_results").select("status, notion_action_page_id, checked_at").eq("client_id", c.id).eq("status", "red").is("notion_action_page_id", null),
      ])
      const results = ((run?.check_results ?? []) as { status: string | null }[])
      const worst = pacing?.pacing.reduce<PlatformPacing["status"] | null>((w, p) => (w === null || SEVERITY[p.status] > SEVERITY[w] ? p.status : w), null) ?? null
      const now = Date.now()
      // Team names: signed-in members plus invited people who haven't signed in yet.
      const members = (c.client_team as unknown as { profiles: { full_name: string | null; email: string } | null }[]).map((t) => t.profiles?.full_name ?? t.profiles?.email)
      const invited = (c.client_team_invites as unknown as { team_invites: { full_name: string | null } | null }[]).map((t) => t.team_invites?.full_name)
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        pacing: pacing?.pacing ?? [],
        worstPacing: worst,
        dataThrough: pacing?.dataThrough ?? null,
        week: run ? { done: results.filter((r) => r.status !== null).length, total: results.length } : null,
        openActions: (actions ?? []).filter((a) => !CLOSED_STATUSES.includes(String((a.properties as Record<string, unknown>)[PROP.status] ?? ""))).length,
        redsNotActioned: (reds ?? []).filter((r) => isRedNotActioned(r as never, now)).length,
        team: [...new Set([...members, ...invited].filter(Boolean) as string[])],
      }
    }),
  )
}
