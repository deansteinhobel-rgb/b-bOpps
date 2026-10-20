import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { londonToday } from "@/lib/checks/periods"
import { loadGoals } from "@/lib/goals"
import { addDays, adHealth, type FatigueInput } from "@/lib/metrics/ads"
import { adsForPeriod } from "@/lib/metrics/ads-period"
import { pickAds, type ReportAd } from "@/lib/metrics/client-report"
import { fatigueInputs } from "@/lib/metrics/fatigue-snapshot"
import { getPacing } from "@/lib/metrics/overview"
import { getPerformance, type Derived } from "@/lib/metrics/performance"
import { adKey, previewsFor, type PreviewMap } from "@/lib/previews"
import { PLATFORMS, type Platform } from "@/lib/metrics/types"
import { loadTargets, targetFor } from "@/lib/targets"
import { STALE_DAYS, type Tone } from "./weekly-message"

/**
 * The weekly Slack snapshot (Dean, 2026-10-20): last week (Monday to Sunday, London) at a glance, with
 * the month so far against budget and pace, the client's main goal against its pace, results and cost
 * per result, and per platform the 2 best and 2 weakest ads plus the ads that have run 30+ days with no
 * results in the last 30. The detail stays in the app (the Client report).
 *
 * SECURITY: reads with the client given (the admin client from the cron route and Admin). Callers
 * confirm who may see it first; nothing here is client-scoped by RLS.
 */

const STALE_SHOWN = 3

/** `image`: a signed link to our copy of the ad's image; `link`: the ad's public post, where there is one. */
export type WeekAd = { name: string; campaign: string | null; spend: number; results: number; cpr: number | null; ctr: number | null; image: string | null; link: string | null; kind: string | null }
export type StaleAd = { name: string; campaign: string | null; ageDays: number; ageCapped: boolean; spend30: number }
export type WeekPlatform = {
  platform: Platform
  now: Derived
  prev: Derived
  target: number | null
  best: WeekAd[]
  bestBasis: "cost_per_result" | "ctr"
  weak: WeekAd[]
  weakBasis: "cost_per_result" | "ctr"
  stale: { count: number; spend30: number; ads: StaleAd[] }
}
export type WeeklySnapshot = {
  client: { id: string; name: string; slug: string; currency: string; logoUrl: string | null }
  week: { from: string; to: string }
  dataThrough: string
  /** Data reaches the week's Sunday. */
  complete: boolean
  now: Derived
  prev: Derived
  target: number | null
  /** Month to date against budget, all platforms together (pacing's month = the data's month). */
  month: {
    month: string
    spend: number
    budget: number | null
    expected: number | null
    through: string
    daysElapsed: number
    daysInMonth: number
    tone: Tone | null
    variancePct: number | null
    /** Each platform against its own budget (pacing's status and bands), biggest budget first. */
    platforms: { platform: Platform; spend: number; budget: number | null; expected: number; tone: Tone | null; variancePct: number | null }[]
  } | null
  goals: { name: string; month: string; value: number | null; target: number | null; expected: number | null; tone: Tone | null; behindPct: number | null }[]
  platforms: WeekPlatform[]
}

/** The Monday-to-Sunday week before the one `today` is in (London dates). */
export function lastWeek(today = londonToday()): { from: string; to: string } {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const monday = addDays(today, -dow)
  return { from: addDays(monday, -7), to: addDays(monday, -1) }
}

/** A goal against where on-pace would be (the Clients cards' rule): within 10%, to 25% behind, further behind. */
const goalTone = (value: number, expected: number): Tone => {
  const behind = expected > 0 ? (expected - value) / expected : 0
  return behind <= 0.1 ? "green" : behind <= 0.25 ? "amber" : "red"
}

const weekAd = (a: ReportAd, previews: PreviewMap): WeekAd => {
  const p = previews[adKey(a)]
  return { name: a.ad_name ?? a.ad_id, campaign: a.campaign_name, spend: a.spend, results: a.results, cpr: a.costPerResult, ctr: a.ctr, image: p?.src ?? null, link: p?.link ?? null, kind: p?.textOnly ? "Search ad" : (p?.kind ?? null) }
}

/** `previewTtl`: how long the ad image links last (seconds). Slack posts keep theirs for 90 days. */
export async function weeklySnapshot(db: SupabaseClient, clientId: string, week = lastWeek(), previewTtl = 3600): Promise<WeeklySnapshot | null> {
  const { data: client } = await db.from("clients").select("id, name, slug, currency, logo_url, monthly_kpi_target").eq("id", clientId).single()
  if (!client) return null
  const [perf, pacing, targets, ads, fatigue] = await Promise.all([
    getPerformance(db, clientId, { range: { kind: "custom", from: week.from, to: week.to } }),
    getPacing(db, clientId),
    loadTargets(db, clientId, client.monthly_kpi_target),
    adsForPeriod(db, clientId, week.from, week.to),
    fatigueInputs(db, clientId),
  ])
  if (!perf) return null
  const dataThrough = perf.dataThrough

  // Ads that have run 30+ days and brought nothing in the last 30 (live = impressions in the last 2 days).
  const live = adHealth(fatigue as unknown as FatigueInput[]).filter((a) => a.ageDays >= STALE_DAYS)
  const last30 = live.length ? await adsForPeriod(db, clientId, addDays(dataThrough, -(STALE_DAYS - 1)), dataThrough) : []
  const byKey = new Map(last30.map((a) => [`${a.platform}|${a.ad_id}`, a]))
  const stale = live
    .map((a) => ({ a, t: byKey.get(`${a.platform}|${a.ad_id}`) }))
    .filter(({ t }) => t && t.spend > 0 && t.conversions + t.leads === 0)
    .map(({ a, t }) => ({ platform: a.platform, name: a.ad_name ?? t!.ad_name ?? a.ad_id, campaign: a.campaign_name, ageDays: a.ageDays, ageCapped: a.firstSeenCapped, spend30: t!.spend }))
    .sort((x, y) => y.spend30 - x.spend30)

  const picked = new Map(PLATFORMS.map((p) => [p, pickAds(ads.filter((a) => a.platform === p), { results: 2, ctr: 0, weak: 2 })]))
  const shown = [...picked.values()].flatMap((x) => [...x.byResults, ...x.byCtr, ...x.worst])
  const previews = await previewsFor(db, clientId, shown, previewTtl)
  const platforms: WeekPlatform[] = PLATFORMS.flatMap((p) => {
    const row = perf.platforms.find((x) => x.platform === p)
    if (!row || (row.now.spend === 0 && row.prev.spend === 0)) return []
    const picks = picked.get(p)!
    const best = picks.byResults.length ? picks.byResults : picks.byCtr
    const mine = stale.filter((s) => s.platform === p)
    return [
      {
        platform: p,
        now: row.now,
        prev: row.prev,
        target: targetFor(targets, p),
        best: best.map((a) => weekAd(a, previews)),
        bestBasis: picks.byResults.length ? ("cost_per_result" as const) : ("ctr" as const),
        weak: picks.worst.map((a) => weekAd(a, previews)),
        weakBasis: picks.worstBasis,
        stale: { count: mine.length, spend30: mine.reduce((s, a) => s + a.spend30, 0), ads: mine.slice(0, STALE_SHOWN) },
      },
    ]
  }).sort((a, b) => b.now.spend - a.now.spend)

  // The month so far, every platform together. Platforms without a budget still count their spend.
  let month: WeeklySnapshot["month"] = null
  if (pacing?.pacing.length) {
    const ps = pacing.pacing
    const spend = ps.reduce((s, p) => s + p.spendMtd, 0)
    const budgeted = ps.filter((p) => p.budget)
    const budget = budgeted.length ? budgeted.reduce((s, p) => s + p.budget!, 0) : null
    const expected = budgeted.length ? budgeted.reduce((s, p) => s + p.expected, 0) : null
    const ratio = expected ? spend / expected : null
    const variancePct = ratio === null ? null : Math.round((ratio - 1) * 100)
    // Pacing's bands: within 10% of pace, more than 20% over, otherwise off pace.
    const tone: Tone | null = ratio === null ? null : ratio > 1.2 ? "red" : Math.abs(ratio - 1) > 0.1 ? "amber" : "green"
    const platforms = ps
      .filter((p) => p.budget || p.spendMtd > 0)
      .map((p) => ({ platform: p.platform, spend: p.spendMtd, budget: p.budget, expected: p.expected, tone: p.status === "no_budget" ? null : p.status, variancePct: p.variancePct === null ? null : Math.round(p.variancePct) }))
      .sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0) || b.spend - a.spend)
    month = { month: ps[0].month, spend, budget, expected, through: pacing.dataThrough, daysElapsed: ps[0].daysElapsed, daysInMonth: ps[0].daysInMonth, tone, variancePct, platforms }
  }

  // The main goal(s), for the month the week ends in, against where on-pace would be by its Sunday.
  const goals = (await loadGoals(db, clientId, week.to, week.to, week.to)).flatMap((g) => {
    const m = g.months[0]
    if (!m) return []
    const tone = m.value !== null && m.expected ? goalTone(m.value, m.expected) : null
    const behindPct = m.value !== null && m.expected ? Math.round(((m.expected - m.value) / m.expected) * 100) : null
    return [{ name: g.name, month: m.month, value: m.value, target: m.target, expected: m.expected, tone, behindPct }]
  })

  return {
    client: { id: client.id, name: client.name, slug: client.slug, currency: client.currency ?? "USD", logoUrl: (client.logo_url as string | null) ?? null },
    week,
    dataThrough,
    complete: dataThrough >= week.to,
    now: perf.now,
    prev: perf.prev,
    target: targetFor(targets, null),
    month,
    goals,
    platforms,
  }
}

/**
 * "Replace weak ads" from the Slack post (Dean, 2026-10-20): a planned sprint test, filled in from last
 * week's weakest and stale ads on one platform. The team reviews it, saves it, then briefs it to Notion
 * through the usual "Brief the team" (dry-run gated as ever).
 */
export function refreshPlan(s: WeeklySnapshot, platform: Platform, label: string, money: (v: number | null) => string) {
  const p = s.platforms.find((x) => x.platform === platform)
  if (!p) return null
  const weak = p.weak.map((a) => `- “${a.name}”${a.campaign ? ` (${a.campaign})` : ""}: ${money(a.spend)} spent, ${a.results ? `${a.results} results at ${money(a.cpr)} each` : "no results"}${a.ctr !== null ? `, CTR ${(a.ctr * 100).toFixed(2)}%` : ""}`)
  const stale = p.stale.ads.map((a) => `- “${a.name}”${a.campaign ? ` (${a.campaign})` : ""}: running ${a.ageCapped ? "90+" : a.ageDays} days, ${money(a.spend30)} in the last 30 days with no results`)
  const more = p.stale.count - p.stale.ads.length
  const notes = [
    `From the weekly Slack snapshot, ${s.week.from} to ${s.week.to}.`,
    weak.length ? `\nWeakest ads last week:\n${weak.join("\n")}` : "",
    stale.length ? `\nRunning ${STALE_DAYS}+ days with no results in the last ${STALE_DAYS}:\n${stale.join("\n")}${more > 0 ? `\n- and ${more} more` : ""}` : "",
    `\nPause these and replace them with new ads.`,
  ].filter(Boolean)
  return {
    platform,
    title: `Replace weak ${label} ads`,
    lever: "creative",
    hypothesis: `Swapping the weakest and stale ${label} ads for new creative brings cost per result ${p.target ? `under the ${money(p.target)} target` : "down"}.`,
    assets: ["ad_creative", "ad_copy"],
    brief_notes: notes.join("\n"),
    success_metric: "cost_per_result",
    success_target: p.target ? String(Math.round(p.target)) : "",
  }
}
export type RefreshPlan = NonNullable<ReturnType<typeof refreshPlan>>
