import type { SupabaseClient } from "@supabase/supabase-js"
import type { AccountNumbers } from "@/lib/account"
import { shortDate } from "@/lib/format"
import { addDays, tiringAds, topAds, type AdStat, type FatiguedAd } from "@/lib/metrics/ads"
import type { getPacing } from "@/lib/metrics/overview"
import type { Platform } from "@/lib/metrics/types"
import { previewsFor } from "@/lib/previews"
import { sprintByNumber, type sprintOf } from "@/lib/sprints/periods"
import { STAGES, stageOf, type TestStatus } from "@/lib/sprints/tests"
import { rpcAll } from "@/lib/supabase/rpc-all"
import type { TimelineEntry } from "@/lib/timeline"
import type { GoalView } from "./goal-card"
import type { PlatformSpend } from "./spend-breakdown"

/**
 * At a glance's data, shared by the classic page (everything at once) and the new layout (each card streams in
 * on its own, Dean 2026-10-15). Loaders take the user's RLS client; the client row was already read through it.
 */
const num = (v: unknown) => Number(v ?? 0)
export const monthName = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(m))
type Period = ReturnType<typeof sprintOf>

export async function loadGoals(supabase: SupabaseClient, clientId: string, today: string): Promise<GoalView[]> {
  const month = `${today.slice(0, 7)}-01`
  const lastMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10)
  const { data: goals } = await supabase.from("client_goals").select("id, name, monthly_target, client_goal_values(month, value, target, updated_at, profiles(full_name, email))").eq("client_id", clientId).eq("active", true).order("position")
  return (goals ?? []).map((g) => {
    const values = (g.client_goal_values ?? []) as unknown as { month: string; value: number | string; target: number | string | null; updated_at: string; profiles: { full_name: string | null; email: string } | null }[]
    const cur = values.find((x) => x.month === month)
    const prev = values.find((x) => x.month === lastMonth)
    const who = cur?.profiles?.full_name ?? cur?.profiles?.email
    return {
      id: g.id,
      name: g.name,
      month,
      monthLabel: monthName(month),
      value: cur ? Number(cur.value) : null,
      target: cur?.target != null ? Number(cur.target) : g.monthly_target != null ? Number(g.monthly_target) : null,
      lastMonthLabel: monthName(lastMonth),
      lastMonth: prev ? Number(prev.value) : null,
      dayOfMonth: Number(today.slice(8, 10)),
      daysInMonth: new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate(),
      updated: cur ? `${shortDate(cur.updated_at.slice(0, 10))}${who ? ` by ${who}` : ""}` : null,
    }
  })
}

/** Budget, where spend should be today, and spend per platform against it. */
export function spendOf(numbers: AccountNumbers | null, pacing: Awaited<ReturnType<typeof getPacing>>) {
  const pacingBy = new Map((pacing?.pacing ?? []).map((p) => [p.platform, p]))
  const budget = (pacing?.pacing ?? []).reduce((s, p) => s + (p.budget ?? 0), 0)
  const expected = (pacing?.pacing ?? []).reduce((s, p) => s + (p.budget ? p.expected : 0), 0)
  const platforms: PlatformSpend[] = (numbers?.byPlatform ?? [])
    .filter((p) => p.mtd.spend > 0 || pacingBy.get(p.platform)?.budget)
    .map((p) => {
      const pc = pacingBy.get(p.platform)
      return { platform: p.platform, spend: p.mtd.spend, budget: pc?.budget ?? null, expected: pc?.budget ? pc.expected : null, results: p.mtd.results, cpr: p.mtd.cpr, lastSpend: p.lastMonthSameDays.spend || null, lastCpr: p.lastMonthSameDays.cpr }
    })
    .sort((a, b) => b.spend - a.spend)
  return { budget, expected, platforms }
}

/** The best ads over the last 30 days, the live ones that look tired (from this morning's snapshot), and their previews. */
export async function loadAds(supabase: SupabaseClient, clientId: string, through: string, liveAds: FatiguedAd[]) {
  const rows = await rpcAll(supabase, "ad_totals", { p_client: clientId, p_from: addDays(through, -29), p_to: through })
  const best = topAds(
    rows.map(
      (r): AdStat => ({
        platform: r.platform as Platform,
        external_account_id: String(r.external_account_id),
        ad_id: String(r.ad_id),
        ad_name: (r.ad_name as string | null) ?? null,
        campaign_name: (r.campaign_name as string | null) ?? null,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        conversions: num(r.conversions),
        leads: num(r.leads),
      }),
    ),
  )
  const tiring = tiringAds(liveAds)
  const previews = await previewsFor(supabase, clientId, [...best.flatMap((p) => p.ads), ...tiring.slice(0, 6)])
  return { best, tiring, previews, unknown: liveAds.filter((a) => a.firstSeenCapped).length }
}

/** What changed in the last 7 days (bulk tool changes left out, as in the timeline's default). */
export function recentOf(timeline: TimelineEntry[], today: string) {
  const weekAgo = Date.parse(today) - 7 * 864e5
  const recent = timeline.filter((e) => !e.bulk && Date.parse(e.at) >= weekAgo)
  const by = { team: recent.filter((e) => e.source === "team").length, platform: recent.filter((e) => e.source === "platform").length, app: recent.filter((e) => e.source === "app").length }
  return { recent, by }
}

/** Sprint tests: this sprint (by stage), the next and the last. */
export async function loadPlans(supabase: SupabaseClient, clientId: string, period: Period) {
  const { data: sprints } = await supabase
    .from("sprints")
    .select("id, number, start_date, end_date, key_takeaway, closed_at")
    .eq("client_id", clientId)
    .in("start_date", [sprintByNumber(period.number - 1).start, period.start, sprintByNumber(period.number + 1).start])
  const byNumber = new Map((sprints ?? []).map((s) => [s.number as number, s]))
  const current = byNumber.get(period.number)
  const next = byNumber.get(period.number + 1)
  const previous = byNumber.get(period.number - 1)
  const ids = [current?.id, next?.id, previous?.id].filter(Boolean) as string[]
  const { data: tests } = ids.length
    ? await supabase.from("sprint_tests").select("id, sprint_id, title, platform, status, outcome, owner_name, deadline, live_on").in("sprint_id", ids).order("created_at")
    : { data: [] as never[] }
  const testsOf = (id?: string) => (tests ?? []).filter((t) => t.sprint_id === id)
  const now = testsOf(current?.id)
    .map((t) => ({ ...t, stage: stageOf({ status: t.status as TestStatus, outcome: t.outcome }, null) }))
    .sort((a, b) => STAGES.findIndex((s) => s.key === a.stage) - STAGES.findIndex((s) => s.key === b.stage))
  return { now, nextTests: testsOf(next?.id), prevTests: testsOf(previous?.id), previous: previous ?? null }
}
export type Plans = Awaited<ReturnType<typeof loadPlans>>
