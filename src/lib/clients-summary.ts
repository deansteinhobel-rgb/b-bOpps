import "server-only"
import type { Db } from "@/lib/supabase/db"
import { createAdminClient } from "@/lib/supabase/admin"
import { currentPeriods } from "@/lib/checks/periods"
import { isRedNotActioned } from "@/lib/checks/runs"
import { cachedPacing } from "@/lib/metrics/cached"
import type { PlatformPacing } from "@/lib/metrics/overview"
import { mockFunnel, type Funnel } from "@/lib/mock-funnel"
import { CLOSED_STATUSES, PROP } from "@/lib/notion/config"
import { sprintOf } from "@/lib/sprints/periods"

export type ClientCard = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  currency: string
  sprint: { number: number; tests: number; live: number; called: number }
  pacing: PlatformPacing[]
  worstPacing: PlatformPacing["status"] | null
  dataThrough: string | null
  week: { done: number; total: number } | null
  openActions: number
  redsNotActioned: number
  team: string[]
  /** The viewer can open this client's pages (RLS). Cards for other clients are summary only. */
  canOpen: boolean
  /** MQL, SQL and pipeline against target (sample numbers for now, see src/lib/mock-funnel.ts). */
  funnel: Funnel
  /** Share of the month gone, for the "on pace" marks (London days). */
  monthPace: number
}

const SEVERITY = { red: 3, amber: 2, green: 1, no_budget: 0 } as const

/**
 * One card per active client, for everyone with a role (Dean, 2026-10-15: every client's mini dashboard on
 * the Clients screen, whatever your role). The cards are read with the secret key, so they hold summary
 * numbers only (pacing, checks done, tests, open actions, team names); `canOpen` says which clients the
 * person can open (RLS), and the client pages stay scoped by RLS as before.
 */
export async function clientCards(supabase: Db): Promise<ClientCard[]> {
  const { weekly, today } = currentPeriods()
  const sprintPeriod = sprintOf(today)
  const db = createAdminClient()
  const [y, m, d] = today.split("-").map(Number)
  const monthPace = d / new Date(Date.UTC(y, m, 0)).getUTCDate()
  const [{ data: clients }, { data: openable }] = await Promise.all([
    db
      .from("clients")
      .select("id, name, slug, logo_url, currency, client_team(profile_id, removed_at, profiles(full_name, email)), client_team_invites(email, removed_at, team_invites(full_name))")
      .eq("active", true)
      .is("client_team.removed_at", null)
      .is("client_team_invites.removed_at", null)
      .order("name"),
    supabase.from("clients").select("id").eq("active", true),
  ])
  const canOpen = new Set((openable ?? []).map((c) => c.id as string))
  const list = clients ?? []

  return Promise.all(
    list.map(async (c) => {
      const [pacing, { data: run }, { data: actions }, { data: reds }, { data: tests }] = await Promise.all([
        cachedPacing(c.id), // summary for every client (see above)
        db.from("check_runs").select("id, check_results(status)").eq("client_id", c.id).eq("cadence", "weekly").eq("period_start", weekly.start).maybeSingle(),
        db.from("notion_pages_mirror").select("properties").eq("client_id", c.id).eq("page_type", "action").eq("in_trash", false),
        db.from("check_results").select("status, notion_action_page_id, checked_at").eq("client_id", c.id).eq("status", "red").is("notion_action_page_id", null),
        db.from("sprint_tests").select("status, outcome, sprints!inner(start_date)").eq("client_id", c.id).is("archived_at", null).eq("sprints.start_date", sprintPeriod.start),
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
        logo_url: (c.logo_url as string | null) ?? null,
        currency: (c.currency as string | null) ?? "USD",
        sprint: {
          number: sprintPeriod.number,
          tests: (tests ?? []).length,
          live: (tests ?? []).filter((t) => t.status === "live" && !t.outcome).length,
          called: (tests ?? []).filter((t) => t.outcome).length,
        },
        pacing: pacing?.pacing ?? [],
        worstPacing: worst,
        dataThrough: pacing?.dataThrough ?? null,
        week: run ? { done: results.filter((r) => r.status !== null).length, total: results.length } : null,
        openActions: (actions ?? []).filter((a) => !CLOSED_STATUSES.includes(String((a.properties as Record<string, unknown>)[PROP.status] ?? ""))).length,
        redsNotActioned: (reds ?? []).filter((r) => isRedNotActioned(r as never, now)).length,
        team: [...new Set([...members, ...invited].filter(Boolean) as string[])],
        canOpen: canOpen.has(c.id),
        funnel: mockFunnel(c.slug, monthPace),
        monthPace,
      }
    }),
  )
}
