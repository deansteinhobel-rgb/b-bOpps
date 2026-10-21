import "server-only"
import { unstable_cache } from "next/cache"
import type { Db } from "@/lib/supabase/db"
import { createAdminClient } from "@/lib/supabase/admin"
import { dataStamp, windsorTag } from "@/lib/metrics/cached"
import { codeFingerprint } from "@/lib/insights/rules"
import { addDays } from "@/lib/metrics/ads"
import { adsForPeriod } from "@/lib/metrics/ads-period"
import { pickAds, type ReportAd } from "@/lib/metrics/client-report"
import { getPerformance, type Derived } from "@/lib/metrics/performance"
import { dataRanges } from "@/lib/metrics/data-range"
import type { RangeSpec } from "@/lib/metrics/range"
import { londonToday } from "@/lib/checks/periods"
import { segmentsFor } from "@/lib/metrics/segments"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { money as fmtMoney, whole } from "@/lib/format"
import { loadFeed } from "@/lib/insights/feed"
import { adKey, previewsFor, type Preview, type PreviewMap } from "@/lib/previews"
import { loadTargets, targetFor } from "@/lib/targets"
import { lastWeek, weeklySnapshot, type WeekAd, type WeeklySnapshot } from "./weekly"
import {
  change,
  moved,
  pctText,
  surging,
  verdictHeadline,
  weeklyBuckets,
  weekTone,
  type AbxRead,
  type AccountRow,
  type AdRow,
  type Flag,
  type FormatRow,
  type OverallRead,
  type ReadAd,
  type ReadItem,
  type Tile,
  type TitleRow,
  type WeeklyRead,
} from "./weekly-read-rules"

/**
 * The weekly read for one client (Dean, 2026-10-21): last week (Monday to Sunday, London) against the
 * week before, in two views. Overall: every platform, from the weekly Slack snapshot's numbers, ads,
 * pacing and goals, plus the open Recommendations. ABX: the client's account-based campaigns (its ABX
 * segment) with the LinkedIn companies and job titles they reached.
 *
 * SECURITY: the numbers are read with the secret key (and cached for everyone). Callers load the client
 * through RLS first (the page does); `user` is the person's own client, for the Recommendations log.
 */
/** Week: those 7 days against the 7 before. Month: the month so far against the same days last month. */
export type PeriodSpec = { kind: "week"; from: string; to: string } | { kind: "month" }

/** The words and dates the read uses for its period. */
type Words = { kind: "week" | "month"; from: string; to: string; range: RangeSpec; current: string; prevWord: string; refreshWeek: string }

export async function loadWeeklyRead(user: Db, client: Client, spec: PeriodSpec): Promise<WeeklyRead | null> {
  const [numbers, feed] = await Promise.all([cachedNumbers(client, spec), loadFeed(user, client.id)])
  if (!numbers) return null
  const { words, snap, daily, abx } = numbers
  const m = moneyIn(snap.client.currency)
  const base = `/clients/${client.slug}`
  const insights = (feed?.insights ?? []).filter((i) => i.state === "open")
  const startHere = new Map((feed?.review?.startHere ?? []).map((s, n) => [s.key, { n, why: s.why }]))
  const overall = buildOverall(snap, daily, insights, startHere, base, m, words)
  const week = { from: words.from, to: words.to }

  // What the totals were compared with: the 7 days before, or the same days last month.
  const prevFrom = words.kind === "week" ? addDays(week.from, -7) : shiftMonth(week.from, -1)
  const prevTo = words.kind === "week" ? addDays(week.to, -7) : minDate(shiftMonth(week.to, -1), addDays(week.from, -1))
  return {
    client: { name: snap.client.name, slug: snap.client.slug, currency: snap.client.currency, logoUrl: snap.client.logoUrl },
    week: { kind: words.kind, from: week.from, to: week.to, prevFrom, prevTo },
    goals: snap.goals.map((g) => ({ name: g.name, value: g.value, target: g.target, expected: g.expected, tone: g.tone, behindPct: g.behindPct })),
    dataThrough: snap.dataThrough,
    complete: snap.complete,
    overall,
    abx,
  }
}

type Client = { id: string; slug: string; monthly_kpi_target: number | string | null }
const moneyIn = (currency: string): Money => (v, digits = 0) => (v === null || v === undefined ? "–" : fmtMoney(v, currency, digits))

/**
 * The slow part of the read (the period's numbers, ads, pacing, goals, the 8-week trend and the ABX view)
 * cached for the London day (Dean, 2026-10-21: it took seconds on every open). The key carries the
 * client's data stamp, so a sync or Claude's review shows straight away, and the windsor tag is dropped
 * when budgets, targets or goals are edited. The Recommendations log is read live on every open.
 * Ad previews are signed for 2 days, longer than an entry can be served.
 */
const DAY = 86_400
const READ_CODE = codeFingerprint(computeNumbers, weeklySnapshot, getPerformance, buildAbx, liSnapshots)
async function cachedNumbers(client: Client, spec: PeriodSpec) {
  const today = londonToday()
  const key = spec.kind === "week" ? `week:${spec.from}` : "month"
  return unstable_cache(() => computeNumbers(createAdminClient(), client, spec, today), ["weekly-read", "v1", READ_CODE, client.id, await dataStamp(client.id), key, today], { tags: ["windsor", windsorTag(client.id)], revalidate: DAY })()
}

async function computeNumbers(admin: Db, client: Client, spec: PeriodSpec, today: string) {
  let words: Words
  if (spec.kind === "week") {
    words = { kind: "week", from: spec.from, to: spec.to, range: { kind: "custom", from: spec.from, to: spec.to }, current: "last week", prevWord: "the week before", refreshWeek: spec.from }
  } else {
    const { data: ranges } = await dataRanges(admin, client.id)
    const through = (ranges ?? []).map((r) => r.data_through as string).sort().at(-1)
    if (!through) return null
    words = { kind: "month", from: `${through.slice(0, 7)}-01`, to: through, range: { kind: "preset", preset: "mtd" }, current: "this month", prevWord: "the same days last month", refreshWeek: lastWeek(today).from }
  }
  const week = { from: words.from, to: words.to }
  const [snap, trend, targets] = await Promise.all([
    weeklySnapshot(admin, client.id, week, 2 * DAY, words.range),
    getPerformance(admin, client.id, { range: { kind: "custom", from: addDays(week.to, -55), to: week.to } }),
    loadTargets(admin, client.id, client.monthly_kpi_target),
  ])
  if (!snap) return null
  const abxDef = segmentsFor(client.slug).find((d) => d.key === "abx")
  const abx = abxDef ? await buildAbx(admin, client.id, snap, words, abxDef, targetFor(targets, "linkedin"), `/clients/${client.slug}`, moneyIn(snap.client.currency)) : null
  return { words, snap, daily: trend?.daily ?? [], abx }
}

/** The same day of another month, clipped to that month's last day. */
function shiftMonth(iso: string, by: number) {
  const [y, mo, d] = iso.split("-").map(Number)
  const last = new Date(Date.UTC(y, mo - 1 + by + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, mo - 1 + by, Math.min(d, last))).toISOString().slice(0, 10)
}
const minDate = (a: string, b: string) => (a < b ? a : b)

type Money = (v: number | null | undefined, digits?: number) => string
type FeedInsight = NonNullable<Awaited<ReturnType<typeof loadFeed>>>["insights"][number]

const readAd = (a: WeekAd, platform: Platform, key: string): ReadAd => ({ key, name: a.name, platform, preview: a.preview })
const kindOf = (p: Preview | null | undefined) => (p?.textOnly ? "Search" : p?.kind ? p.kind.replace(/ ad$/, "") : "Single image")

/** Tiles for the week against the week before, each with its last 8 weeks. */
function tiles(now: Derived, prev: Derived, daily: ({ date: string } & Derived)[], to: string, target: number | null, m: Money): Tile[] {
  const spark = (f: (d: Derived) => number) => weeklyBuckets(daily.map((d) => ({ date: d.date, value: f(d) })), to)
  const spend = spark((d) => d.spend)
  const results = spark((d) => d.results)
  const clicks = spark((d) => d.clicks)
  const imps = spark((d) => d.impressions)
  const cprC = change(now.cpr, prev.cpr)
  const ctrC = change(now.ctr, prev.ctr)
  return [
    { label: "Spend", now: m(now.spend), before: m(prev.spend), change: pctText(change(now.spend, prev.spend)), tone: "neutral", spark: spend },
    { label: "Results", hint: "Conversions plus leads.", now: whole(now.results), before: whole(prev.results), change: pctText(change(now.results, prev.results)), tone: toneUp(change(now.results, prev.results)), spark: results },
    {
      label: "Cost per result",
      hint: `Spend divided by results.${target ? ` Target ${m(target)}.` : ""}`,
      now: m(now.cpr),
      before: prev.cpr === null ? null : m(prev.cpr),
      change: pctText(cprC),
      tone: cprC === null ? "neutral" : cprC <= -0.05 ? "good" : cprC >= 0.05 ? "bad" : "neutral",
      spark: spend.map((s, i) => (results[i] ? s / results[i] : 0)),
    },
    { label: "Clicks", now: whole(now.clicks), before: whole(prev.clicks), change: pctText(change(now.clicks, prev.clicks)), tone: toneUp(change(now.clicks, prev.clicks)), spark: clicks },
    { label: "CTR", hint: "Clicks divided by impressions.", now: pct(now.ctr), before: pct(prev.ctr), change: ctrC === null ? null : `${ctrC >= 0 ? "+" : "−"}${Math.abs(((now.ctr ?? 0) - (prev.ctr ?? 0)) * 100).toFixed(2)} pts`, tone: toneUp(ctrC), spark: imps.map((v, i) => (v ? clicks[i] / v : 0)) },
  ]
}
const toneUp = (c: number | null) => (c === null ? ("neutral" as const) : c >= 0.05 ? ("good" as const) : c <= -0.05 ? ("bad" as const) : ("neutral" as const))
const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(2)}%`)

const insightHref = (base: string, key: string) => `${base}/insights?i=${encodeURIComponent(key)}`
const ICON_FOR_RULE: Partial<Record<string, ReadItem["icon"]>> = { negatives: "search", keywords: "search", budget_capped: "wallet", rank_lost: "trend-down", no_spend: "wallet", ctr_up: "trend-up", high_cpl: "wallet", no_results: "flag", li_companies: "building", li_not_icp: "building", li_own_company: "building", li_weak_segments: "users", li_strong_segments: "users", li_junior: "title", meta_frequency: "repeat", meta_learning: "refresh", meta_placements: "split", meta_ages: "users", meta_lookalike: "users" }
const insightItem = (i: FeedInsight, base: string, why?: string): ReadItem => ({
  key: `insight:${i.key}`,
  icon: ICON_FOR_RULE[i.rule] ?? "bolt",
  title: i.title,
  tag: i.urgent ? "Urgent" : i.category === "opportunity" ? "Opportunity" : undefined,
  detail: why ?? i.todo,
  platform: i.platform === "ga4" ? null : i.platform,
  href: insightHref(base, i.key),
  action: { label: "Open", href: insightHref(base, i.key) },
})
const sevRank = { high: 0, medium: 1, low: 2 } as const

function buildOverall(snap: WeeklySnapshot, daily: ({ date: string } & Derived)[], insights: FeedInsight[], startHere: Map<string, { n: number; why: string }>, base: string, m: Money, w: Words): OverallRead {
  const { now, prev, target } = snap
  const tone = weekTone({ results: now.results, prevResults: prev.results, spend: now.spend, cpr: now.cpr, target })
  const results = weeklyBuckets(daily.map((d) => ({ date: d.date, value: d.results })), snap.week.to)

  // The body: what moved, the strongest and weakest platform, then the month's pacing.
  const body: string[] = []
  if (now.results || prev.results) body.push(`Results ${moved(whole(now.results), whole(prev.results), now.results === prev.results ? null : now.results > prev.results)}${now.cpr !== null && prev.cpr !== null ? ` and cost per result ${moved(m(now.cpr), m(prev.cpr), Math.round(now.cpr) === Math.round(prev.cpr) ? null : now.cpr > prev.cpr)}` : ""}.`)
  const byCpr = snap.platforms.filter((p) => p.now.results >= now.results * 0.1 && p.now.results > 0 && p.now.cpr !== null).sort((a, b) => (a.now.cpr! / (a.target ?? a.now.cpr!)) - (b.now.cpr! / (b.target ?? b.now.cpr!)))
  const strongest = byCpr[0]
  if (strongest && snap.platforms.length > 1) body.push(`${PLATFORM_LABEL[strongest.platform]} did the most for the money: ${whole(strongest.now.results)} results at ${m(strongest.now.cpr)}.`)
  const weakest = snap.platforms.find((p) => p.now.spend > 0 && p.target !== null && (p.now.cpr === null ? p.now.spend >= p.target : p.now.cpr > p.target * 1.2) && p !== strongest)
  if (weakest) body.push(`${PLATFORM_LABEL[weakest.platform]} is the weak spot: ${m(weakest.now.spend)} spent for ${weakest.now.results ? `${whole(weakest.now.results)} result${weakest.now.results === 1 ? "" : "s"} (${m(weakest.now.cpr)} each)` : "no results"}.`)
  // Pacing is this month's; only said when the week ends in it.
  if (snap.month?.budget && snap.month.month.slice(0, 7) === snap.week.to.slice(0, 7)) body.push(`${monthLabel(snap.month.month)} is ${Math.round((snap.month.daysElapsed / snap.month.daysInMonth) * 100)}% through and ${Math.round((snap.month.spend / snap.month.budget) * 100)}% of the budget is spent${snap.month.tone === "green" ? ", about right" : snap.month.variancePct !== null ? `, ${Math.abs(snap.month.variancePct)}% ${snap.month.variancePct > 0 ? "ahead of" : "behind"} pace` : ""}.`)

  for (const g of snap.goals.filter((g) => g.value !== null && g.target))
    body.push(`${g.name}: ${whole(g.value)} of ${whole(g.target)} this month${g.behindPct === null ? "" : g.behindPct <= 0 ? ", on pace" : `, ${g.behindPct}% behind pace`}.`)

  // Every ad the snapshot picked, keyed so the columns, flags and table share one preview.
  const ad = (p: Platform, a: WeekAd) => readAd(a, p, `${p}|${a.name}`)
  const bests = snap.platforms.flatMap((p) => p.best.map((a) => ({ p, a })))
  const weaks = snap.platforms.flatMap((p) => p.weak.map((a) => ({ p, a })))

  const working: ReadItem[] = []
  const topAd = bests.filter(({ a }) => a.results > 0 && a.cpr !== null).sort((x, y) => x.a.cpr! - y.a.cpr!)[0]
  if (topAd) working.push({ key: "best-ad", icon: "doc", title: topAd.a.name, tag: "Best ad", detail: `${whole(topAd.a.results)} result${topAd.a.results === 1 ? "" : "s"} at ${m(topAd.a.cpr)}, the lowest cost per result ${w.current}`, platform: topAd.p.platform, ads: [ad(topAd.p.platform, topAd.a)], href: `${base}/reporting/client-report?platform=${topAd.p.platform}&from=${snap.week.from}&to=${snap.week.to}` })
  for (const p of snap.platforms.filter((p) => p.target !== null && p.now.results > 0 && p.now.cpr! <= p.target!).slice(0, 2))
    working.push({ key: `on-target:${p.platform}`, icon: "target", title: PLATFORM_LABEL[p.platform], tag: "On target", detail: `${whole(p.now.results)} results at ${m(p.now.cpr)} against ${m(p.target)}${p.prev.cpr !== null ? `, ${p.now.cpr! <= p.prev.cpr ? "down" : "up"} from ${m(p.prev.cpr)}` : ""}`, platform: p.platform, href: `${base}/reporting?platform=${p.platform}&from=${snap.week.from}&to=${snap.week.to}` })
  for (const g of snap.goals.filter((g) => g.tone === "green").slice(0, 1))
    working.push({ key: `goal:${g.name}`, icon: "goal", title: g.name, tag: "On pace", detail: `${whole(g.value)} so far${g.target ? ` of ${whole(g.target)}` : ""} this month`, href: base })
  for (const i of insights.filter((i) => i.category === "opportunity").slice(0, Math.max(0, 3 - working.length))) working.push(insightItem(i, base))

  const attention: ReadItem[] = []
  for (const i of insights.filter((i) => i.urgent).slice(0, 2)) attention.push(insightItem(i, base))
  for (const p of snap.platforms.filter((p) => p.target !== null && p.now.spend > 0 && (p.now.cpr === null ? p.now.spend >= p.target! : p.now.cpr > p.target! * 1.2)))
    attention.push({ key: `over:${p.platform}`, icon: "wallet", title: PLATFORM_LABEL[p.platform], tag: p.now.results ? "Over target" : "No results", detail: `${m(p.now.spend)} spent, ${p.now.results ? `${whole(p.now.results)} result${p.now.results === 1 ? "" : "s"} (${m(p.now.cpr)} each against ${m(p.target)})` : `no results against a ${m(p.target)} target`}`, platform: p.platform, href: `${base}/reporting?platform=${p.platform}&from=${snap.week.from}&to=${snap.week.to}`, action: { label: "Open the report", href: `${base}/reporting/client-report?platform=${p.platform}&from=${snap.week.from}&to=${snap.week.to}` } })
  if (snap.month && (snap.month.tone === "red" || snap.month.tone === "amber") && snap.month.budget && snap.month.month.slice(0, 7) === snap.week.to.slice(0, 7))
    attention.push({ key: "pacing", icon: "wallet", title: "Budget pacing", tag: snap.month.variancePct !== null && snap.month.variancePct > 0 ? "Ahead of pace" : "Behind pace", detail: `${m(snap.month.spend)} of ${m(snap.month.budget)} spent, where pace says ${m(snap.month.expected)}`, href: `${base}/reporting#pacing` })
  const staleAll = snap.platforms.filter((p) => p.stale.count > 0)
  if (staleAll.length) {
    const count = staleAll.reduce((s, p) => s + p.stale.count, 0)
    const spend = staleAll.reduce((s, p) => s + p.stale.spend30, 0)
    attention.push({ key: "stale", icon: "refresh", title: `${count} tired ad${count === 1 ? "" : "s"}`, tag: "No results in 30 days", detail: `Live 30+ days, ${m(spend)} in the last 30 days with no results`, href: `${base}/reporting#fatigue` })
  }
  for (const g of snap.goals.filter((g) => g.tone === "red" || g.tone === "amber").slice(0, 1))
    attention.push({ key: `goal:${g.name}`, icon: "goal", title: g.name, tag: "Behind pace", detail: `${whole(g.value)} so far${g.target ? ` of ${whole(g.target)}` : ""}, ${g.behindPct}% behind pace`, href: base })

  // Where to act: Claude's "start here" first, then the open recommendations by severity and money at stake.
  const shown = new Set(attention.map((a) => a.key).concat(working.map((w) => w.key)))
  const ranked = insights
    .filter((i) => !shown.has(`insight:${i.key}`) && i.category !== "opportunity")
    .sort((a, b) => (startHere.get(a.key)?.n ?? 99) - (startHere.get(b.key)?.n ?? 99) || sevRank[a.severity] - sevRank[b.severity] || (b.atStake ?? 0) - (a.atStake ?? 0))
  const act: ReadItem[] = ranked.slice(0, 3).map((i) => insightItem(i, base, startHere.get(i.key)?.why))
  const refresh = snap.platforms.find((p) => p.weak.length || p.stale.count)
  if (refresh && act.length < 3)
    act.push({ key: `refresh:${refresh.platform}`, icon: "refresh", title: `Replace weak ${PLATFORM_LABEL[refresh.platform]} ads`, detail: `${refresh.weak.length ? `The ${refresh.weak.length} weakest ${w.current}` : ""}${refresh.weak.length && refresh.stale.count ? " and " : ""}${refresh.stale.count ? `${refresh.stale.count} with no results in 30 days` : ""}`, platform: refresh.platform, ads: refresh.weak.map((a) => ad(refresh.platform, a)), action: { label: "Plan a test", href: `${base}/sprint?refresh=${refresh.platform}&week=${w.refreshWeek}` } })

  const green: Flag[] = [
    ...bests.filter(({ a }) => a.results > 0).slice(0, 3).map(({ p, a }) => ({ key: `best:${p.platform}:${a.name}`, kind: "Best ad", subject: a.name, detail: `${whole(a.results)} result${a.results === 1 ? "" : "s"} at ${m(a.cpr)}`, platform: p.platform, ad: ad(p.platform, a) })),
    ...snap.platforms.filter((p) => p.now.cpr !== null && p.prev.cpr !== null && p.now.cpr <= p.prev.cpr * 0.9).map((p) => ({ key: `cheaper:${p.platform}`, kind: "Cheaper", subject: PLATFORM_LABEL[p.platform], detail: `${m(p.now.cpr)} a result, down from ${m(p.prev.cpr)}`, platform: p.platform })),
    ...snap.goals.filter((g) => g.tone === "green").map((g) => ({ key: `goal:${g.name}`, kind: "On pace", subject: g.name, detail: `${whole(g.value)} so far this month` })),
  ]
  const red: Flag[] = [
    ...snap.platforms.filter((p) => p.target !== null && p.now.cpr !== null && p.now.cpr > p.target * 1.2).map((p) => ({ key: `over:${p.platform}`, kind: "Over target", subject: PLATFORM_LABEL[p.platform], detail: `${m(p.now.cpr)} a result against ${m(p.target)}`, platform: p.platform })),
    ...weaks.slice(0, 3).map(({ p, a }) => ({ key: `weak:${p.platform}:${a.name}`, kind: a.results ? "Weakest ad" : "No results", subject: a.name, detail: a.results ? `${m(a.cpr)} a result on ${m(a.spend)}` : `${m(a.spend)} ${w.current}, no results`, platform: p.platform, ad: ad(p.platform, a) })),
    ...staleAll.flatMap((p) => p.stale.ads.slice(0, 2).map((s) => ({ key: `stale:${p.platform}:${s.name}`, kind: "Tired ad", subject: s.name, detail: `live ${s.ageCapped ? "90+" : s.ageDays} days, ${m(s.spend30)} in 30 days with no results`, platform: p.platform }))),
    ...insights.filter((i) => i.urgent).map((i) => ({ key: `urgent:${i.key}`, kind: "Urgent", subject: i.title, detail: i.todo, platform: i.platform === "ga4" ? null : i.platform, href: insightHref(base, i.key) })),
  ]

  const platformRows = snap.platforms.map((p) => {
    const mo = snap.month?.platforms.find((x) => x.platform === p.platform)
    return { platform: p.platform, spend: p.now.spend, results: p.now.results, cpr: p.now.cpr, prevCpr: p.prev.cpr, target: p.target, month: mo ? { spend: mo.spend, budget: mo.budget, expected: mo.expected } : null }
  })
  const adRows: AdRow[] = bests
    .map(({ p, a }) => ({ ad: ad(p.platform, a), format: a.kind?.replace(/ ad$/, "") ?? kindOf(a.preview), campaign: a.campaign, results: a.results, cpr: a.cpr, ctr: a.ctr, spend: a.spend }))
    .sort((x, y) => y.results - x.results || (x.cpr ?? Infinity) - (y.cpr ?? Infinity))

  return {
    verdict: {
      headline: verdictHeadline({ tone, results: now.results, spend: m(now.spend), cpr: now.cpr === null ? null : m(now.cpr), target: target === null ? null : m(target), underTarget: target === null || now.cpr === null ? null : now.cpr <= target, period: w.kind }),
      tone,
      body: body.join(" "),
      trend: results,
      trendLabel: "Results, last 8 weeks",
    },
    working: working.slice(0, 3),
    attention: attention.slice(0, 3),
    act,
    tiles: tiles(now, prev, daily, snap.week.to, target, m),
    green: green.slice(0, 6),
    red: red.slice(0, 6),
    platforms: platformRows,
    ads: adRows,
  }
}

// ---------- ABX ----------

type Company = { name: string; impressions: number; clicks: number; spend: number; campaigns: Set<string> }

/**
 * The LinkedIn breakdown snapshots of one kind (30-day totals, refreshed about weekly) for the given
 * campaigns: the latest on or just after `to`, then earlier ones at least 5 days apart (up to 5, for the
 * trend), with the one about a week before and about a month before picked out.
 */
async function liSnapshots(db: Db, clientId: string, kind: string, to: string, campaignIds: string[]) {
  type Snap = { date: string; rows: Company[] }
  const empty = { latest: null as Snap | null, weekBefore: null as Snap | null, monthBefore: null as Snap | null, all: [] as Snap[] }
  if (!campaignIds.length) return empty
  // Each date with one small query: the newest on or before the cutoff.
  const dateBefore = async (cutoff: string) => (await db.from("windsor_breakdowns").select("date").eq("client_id", clientId).eq("kind", kind).lte("date", cutoff).order("date", { ascending: false }).limit(1).maybeSingle()).data?.date as string | undefined
  const dates: string[] = []
  let cutoff = addDays(to, 3)
  for (let i = 0; i < 5; i++) {
    const d = await dateBefore(cutoff)
    if (!d) break
    dates.push(d)
    cutoff = addDays(d, -5)
  }
  if (!dates.length) return empty
  const load = async (date: string): Promise<Snap> => {
    const rows: { dim1: string | null; campaign_id: string | null; spend: number; impressions: number; clicks: number }[] = []
    for (let from = 0; ; from += 1000) {
      const { data: page } = await db.from("windsor_breakdowns").select("dim1, campaign_id, spend, impressions, clicks").eq("client_id", clientId).eq("kind", kind).eq("date", date).in("campaign_id", campaignIds).range(from, from + 999)
      rows.push(...((page ?? []) as typeof rows))
      if (!page || page.length < 1000) break
    }
    const by = new Map<string, Company>()
    for (const r of rows) {
      if (!r.dim1) continue
      const c = by.get(r.dim1) ?? { name: r.dim1, impressions: 0, clicks: 0, spend: 0, campaigns: new Set<string>() }
      c.impressions += Number(r.impressions ?? 0)
      c.clicks += Number(r.clicks ?? 0)
      c.spend += Number(r.spend ?? 0)
      if (r.campaign_id) c.campaigns.add(r.campaign_id)
      by.set(r.dim1, c)
    }
    return { date, rows: [...by.values()] }
  }
  const all = await Promise.all(dates.map(load))
  const latest = all[0]
  const back = (days: number) => all.find((s) => Date.parse(latest.date) - Date.parse(s.date) >= days * 86_400_000) ?? null
  // Oldest first, for trends.
  return { latest, weekBefore: back(5), monthBefore: back(21), all: all.slice().reverse() }
}

async function buildAbx(admin: Db, clientId: string, snap: WeeklySnapshot, w: Words, def: { key: string; label: string; pattern: RegExp }, target: number | null, base: string, m: Money): Promise<AbxRead> {
  const isAbx = (name: string | null | undefined) => def.pattern.test(name ?? "")
  const week = { from: w.from, to: w.to }
  const segment = { key: def.key, defs: segmentsFor(snap.client.slug) }
  // The ABX campaigns on LinkedIn over the last 8 weeks decide which company and title rows count.
  const trend = await getPerformance(admin, clientId, { range: { kind: "custom", from: addDays(week.to, -55), to: week.to }, segment })
  const liCampaigns = (trend?.campaigns ?? []).filter((c) => c.platform === "linkedin").map((c) => c.campaignId)
  const [perf, ads, companies, titleSnaps, review] = await Promise.all([
    getPerformance(admin, clientId, { range: w.range, segment }),
    adsForPeriod(admin, clientId, week.from, week.to),
    liSnapshots(admin, clientId, "li_company", week.to, liCampaigns),
    liSnapshots(admin, clientId, "li_job_title", week.to, liCampaigns),
    admin.from("insight_reviews").select("companies").eq("client_id", clientId).eq("status", "ready").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  const now = perf?.now
  const prev = perf?.prev
  const daily = trend?.daily ?? []

  // Ads in the ABX campaigns last week, with their format from the preview (document, carousel...).
  const abxAds = ads.filter((a) => isAbx(a.campaign_name) && a.spend > 0)
  const previews: PreviewMap = abxAds.length ? await previewsFor(admin, clientId, abxAds, 2 * DAY) : {}
  const asRead = (a: ReportAd | (typeof abxAds)[number]): ReadAd => ({ key: adKey(a), name: a.ad_name ?? a.ad_id, platform: a.platform, preview: previews[adKey(a)] ?? null })
  const formatOf = (a: (typeof abxAds)[number]) => kindOf(previews[adKey(a)])
  const formats = new Map<string, FormatRow>()
  for (const a of [...abxAds].sort((x, y) => y.spend - x.spend)) {
    const f = formatOf(a)
    const row = formats.get(f) ?? { format: f, ads: [], count: 0, spend: 0, impressions: 0, clicks: 0, results: 0 }
    row.count++
    row.spend += a.spend
    row.impressions += a.impressions
    row.clicks += a.clicks
    row.results += a.conversions + a.leads
    if (row.ads.length < 3) row.ads.push(asRead(a))
    formats.set(f, row)
  }
  const formatRows = [...formats.values()].sort((a, b) => b.spend - a.spend)
  const picks = pickAds(abxAds, { results: 5, ctr: 3, weak: 3 })
  const adRows: AdRow[] = [...picks.byResults, ...picks.byCtr].map((a) => ({ ad: asRead(a), format: formatOf(a), campaign: a.campaign_name, results: a.results, cpr: a.costPerResult, ctr: a.ctr, spend: a.spend }))

  // Accounts: LinkedIn companies the ABX campaigns reached (30-day totals), judged by Claude's daily review.
  const fits = new Map(((review.data?.companies ?? []) as { name: string; fit: "icp" | "not_icp" | "unsure"; reason?: string }[]).map((c) => [c.name.toLowerCase(), c]))
  const latest = companies.latest?.rows ?? []
  const monthBefore = new Map((companies.monthBefore?.rows ?? []).map((c) => [c.name, c]))
  const history = (name: string) => companies.all.map((s) => s.rows.find((r) => r.name === name)?.clicks ?? 0)
  const account = (c: Company, reason?: string): AccountRow => {
    const f = fits.get(c.name.toLowerCase())
    return { name: c.name, impressions: c.impressions, clicks: c.clicks, spend: c.spend, campaigns: c.campaigns.size, ctr: c.impressions ? c.clicks / c.impressions : null, fit: f?.fit ?? null, fitReason: f?.reason ?? null, reason, trend: history(c.name) }
  }
  const engaged = latest.filter((c) => c.clicks > 0)
  const engagedBefore = companies.weekBefore ? companies.weekBefore.rows.filter((c) => c.clicks > 0).length : null
  const reached = latest.filter((c) => c.impressions > 0).length
  const reachedBefore = companies.weekBefore ? companies.weekBefore.rows.filter((c) => c.impressions > 0).length : null
  const isNotIcp = (c: Company) => fits.get(c.name.toLowerCase())?.fit === "not_icp"
  // Surging against every account's average, but never a company Claude's review says isn't ICP.
  const surgeAll = surging(latest)
  const surge = { ...surgeAll, rows: surgeAll.rows.filter((c) => !isNotIcp(c)) }
  const prioritize = latest
    .filter((c) => !isNotIcp(c) && c.impressions >= 100 && c.clicks >= 2)
    .sort((a, b) => b.clicks / b.impressions - a.clicks / a.impressions)
    .slice(0, 10)
    .map((c) => account(c))
  const minSpend = Math.max(50, (target ?? 300) / 2)
  const watch = [
    ...latest.filter((c) => isNotIcp(c) && c.spend >= 20).map((c) => account(c, `Not ICP (Claude): ${fits.get(c.name.toLowerCase())?.reason ?? "doesn't fit the brief"}`)),
    ...latest.filter((c) => !isNotIcp(c) && c.clicks === 0 && c.spend >= minSpend).map((c) => account(c, `${m(c.spend)} in 30 days, no clicks`)),
    ...[...monthBefore.values()].filter((o) => o.clicks >= 5 && (latest.find((c) => c.name === o.name)?.clicks ?? 0) === 0).map((o) => account(latest.find((c) => c.name === o.name) ?? { ...o, impressions: 0, clicks: 0, spend: 0 }, `${o.clicks} clicks a month ago, none in the last 30 days`)),
  ]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10)
  const titles: TitleRow[] = (titleSnaps.latest?.rows ?? [])
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10)
    .map((t) => ({ title: t.name, spend: t.spend, impressions: t.impressions, clicks: t.clicks, ctr: t.impressions ? t.clicks / t.impressions : null }))

  // The verdict: accounts first (that's what ABX is for), then results.
  const eChange = engagedBefore === null ? null : engaged.length - engagedBefore
  const tone = eChange === null ? "neutral" : eChange > 0 ? "good" : eChange < 0 ? "bad" : "neutral"
  const headline = engagedBefore === null ? `${engaged.length} account${engaged.length === 1 ? "" : "s"} engaged in the last 30 days` : `${engaged.length} account${engaged.length === 1 ? "" : "s"} engaged, ${eChange! > 0 ? `up from ${engagedBefore}` : eChange! < 0 ? `down from ${engagedBefore}` : "the same as a week before"}`
  const body = [
    `${def.label} ads reached ${whole(reached)} companies in the last 30 days${reachedBefore !== null ? ` (${whole(reachedBefore)} a week before)` : ""}.`,
    surge.rows.length ? `${surge.rows.length} ${surge.rows.length === 1 ? "is" : "are"} surging, clicking at 3x the average or more.` : "",
    now ? `${w.current.charAt(0).toUpperCase()}${w.current.slice(1)}: ${m(now.spend)} spent, ${whole(now.results)} result${now.results === 1 ? "" : "s"}${now.cpr !== null ? ` at ${m(now.cpr)} each` : ""}.` : "",
    watch.length ? `${watch.length} account${watch.length === 1 ? " needs" : "s need"} a look (not ICP, spend without clicks, or gone quiet).` : "",
  ].filter(Boolean)
  const engagedTrend = companies.all.map((s) => s.rows.filter((c) => c.clicks > 0).length)

  const working: ReadItem[] = []
  const bestFormat = formatRows.filter((f) => f.impressions >= 1000).sort((a, b) => b.clicks / b.impressions - a.clicks / a.impressions)[0]
  if (bestFormat) working.push({ key: "best-format", icon: "doc", title: `${bestFormat.format} ads`, tag: "Best format", detail: `${pct(bestFormat.clicks / bestFormat.impressions)} CTR across ${bestFormat.count} ad${bestFormat.count === 1 ? "" : "s"}, ${Math.round((bestFormat.spend / Math.max(1, formatRows.reduce((s, f) => s + f.spend, 0))) * 100)}% of spend`, platform: "linkedin", ads: bestFormat.ads })
  if (surge.rows.length) working.push({ key: "surging", icon: "trend-up", title: `${surge.rows.length} surging account${surge.rows.length === 1 ? "" : "s"}`, tag: "Showing intent", detail: surge.rows.sort((a, b) => b.clicks / b.impressions - a.clicks / a.impressions).slice(0, 3).map((c) => c.name).join(", ") + (surge.rows.length > 3 ? ` and ${surge.rows.length - 3} more` : ""), platform: "linkedin" })
  const topAbxAd = picks.byResults[0] ?? picks.byCtr[0]
  if (topAbxAd) working.push({ key: "abx-best-ad", icon: "doc", title: topAbxAd.ad_name ?? topAbxAd.ad_id, tag: "Best ad", detail: topAbxAd.results ? `${whole(topAbxAd.results)} result${topAbxAd.results === 1 ? "" : "s"} at ${m(topAbxAd.costPerResult)}` : `${pct(topAbxAd.ctr)} CTR on ${whole(topAbxAd.impressions)} impressions`, platform: topAbxAd.platform, ads: [asRead(topAbxAd)] })

  const attention: ReadItem[] = []
  const notIcp = latest.filter((c) => isNotIcp(c) && c.spend > 0)
  if (notIcp.length) attention.push({ key: "not-icp", icon: "building", title: `${notIcp.length} compan${notIcp.length === 1 ? "y" : "ies"} outside the ICP`, tag: "Not ICP", detail: `${m(notIcp.reduce((s, c) => s + c.spend, 0))} in 30 days on companies Claude's review says don't fit`, platform: "linkedin", href: `${base}/insights` })
  const noClicks = latest.filter((c) => !isNotIcp(c) && c.clicks === 0 && c.spend >= minSpend)
  if (noClicks.length) attention.push({ key: "no-clicks", icon: "wallet", title: `${noClicks.length} account${noClicks.length === 1 ? "" : "s"} taking spend without clicks`, tag: "Spend, no clicks", detail: `${m(noClicks.reduce((s, c) => s + c.spend, 0))} in 30 days, ${m(minSpend)}+ each`, platform: "linkedin" })
  if (now && target !== null && now.spend > 0 && (now.cpr === null ? now.spend >= target : now.cpr > target * 1.2))
    attention.push({ key: "abx-over", icon: "wallet", title: `${def.label} cost per result`, tag: now.results ? "Over target" : "No results", detail: now.results ? `${m(now.cpr)} a result against ${m(target)}` : `${m(now.spend)} ${w.current}, no results`, platform: "linkedin" })

  const act: ReadItem[] = []
  if (prioritize.length) act.push({ key: "share", icon: "users", title: `Share ${Math.min(5, prioritize.length)} engaged accounts with the AMs`, detail: prioritize.slice(0, 3).map((a) => a.name).join(", ") + (prioritize.length > 3 ? " and more" : ""), action: { label: "See the list", href: "#accounts" } })
  if (notIcp.length || noClicks.length) act.push({ key: "exclude", icon: "building", title: `Exclude ${notIcp.length + noClicks.length} account${notIcp.length + noClicks.length === 1 ? "" : "s"} in LinkedIn`, detail: "The team excludes them in Campaign Manager; Lumaux doesn't change targeting", action: { label: "See the list", href: "#watch" } })
  const weakFormat = formatRows.find((f) => f !== bestFormat && f.spend > 0 && bestFormat && f.impressions >= 1000 && f.clicks / f.impressions < (bestFormat.clicks / bestFormat.impressions) / 2)
  if (weakFormat && bestFormat) act.push({ key: "move-budget", icon: "split", title: `Move budget from ${weakFormat.format.toLowerCase()} to ${bestFormat.format.toLowerCase()} ads`, detail: `${pct(bestFormat.clicks / bestFormat.impressions)} CTR against ${pct(weakFormat.clicks / weakFormat.impressions)}`, action: { label: "Plan a test", href: `${base}/sprint` } })

  const green: Flag[] = [
    ...surge.rows.slice(0, 4).map((c) => ({ key: `surge:${c.name}`, kind: "Surging", subject: c.name, detail: `CTR ${pct(c.clicks / c.impressions)} on ${whole(c.impressions)} impressions` })),
    ...picks.byResults.slice(0, 2).map((a) => ({ key: `best:${adKey(a)}`, kind: "Best ad", subject: a.ad_name ?? a.ad_id, detail: `${whole(a.results)} result${a.results === 1 ? "" : "s"} at ${m(a.costPerResult)}`, platform: a.platform, ad: asRead(a) })),
  ]
  const red: Flag[] = [
    ...watch.slice(0, 5).map((a) => ({ key: `watch:${a.name}`, kind: a.reason?.startsWith("Not ICP") ? "Not ICP" : a.reason?.includes("none in") ? "Went quiet" : "Spend, no clicks", subject: a.name, detail: a.reason?.replace(/^Not ICP \(Claude\): /, "") ?? "" })),
    ...picks.worst.slice(0, 2).map((a) => ({ key: `weak:${adKey(a)}`, kind: a.results ? "Weakest ad" : "No results", subject: a.ad_name ?? a.ad_id, detail: a.results ? `${m(a.costPerResult)} a result` : `${m(a.spend)} ${w.current}, no results`, platform: a.platform, ad: asRead(a) })),
  ]

  const coreTiles: Tile[] = [
    { label: "Accounts reached", hint: "Companies LinkedIn showed the ABX ads to, last 30 days (LinkedIn only reports companies with enough members reached).", now: whole(reached), before: reachedBefore === null ? null : whole(reachedBefore), change: reachedBefore === null ? null : signed(reached - reachedBefore), tone: reachedBefore === null ? "neutral" : toneUp(change(reached, reachedBefore)), spark: companies.all.map((s) => s.rows.filter((c) => c.impressions > 0).length) },
    { label: "Engaged accounts", hint: "Companies with at least one click, last 30 days.", now: whole(engaged.length), before: engagedBefore === null ? null : whole(engagedBefore), change: eChange === null ? null : signed(eChange), tone, spark: engagedTrend },
    { label: "Surging", hint: "Companies clicking at 3x the ABX average or more (100+ impressions, 3+ clicks).", now: whole(surge.rows.length), before: null, change: null, tone: "neutral", spark: [] },
    ...(now && prev ? tiles(now, prev, daily, week.to, target, m).filter((t) => t.label === "Spend" || t.label === "CTR" || t.label === "Results") : []),
  ]

  return {
    segmentLabel: def.label,
    verdict: { headline, tone, body: body.join(" "), trend: engagedTrend.length > 1 ? engagedTrend : weeklyBuckets(daily.map((d) => ({ date: d.date, value: d.clicks })), week.to), trendLabel: engagedTrend.length > 1 ? "Engaged accounts, by LinkedIn snapshot" : "Clicks, last 8 weeks" },
    working,
    attention,
    act,
    tiles: coreTiles,
    green,
    red,
    formats: formatRows,
    ads: adRows,
    prioritize,
    watch,
    titles,
    accountsThrough: companies.latest?.date ?? null,
  }
}
/** "October" from "2026-10" or "2026-10-01". */
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${m.slice(0, 7)}-01T00:00:00Z`))
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`
