import { METRICS } from "./tests"

/**
 * How a live test is doing (Dean, 2026-09-30). A plain module: the verdict rules and the shapes the
 * board, the side panel and Claude's read share. The loader is `test-results.ts` (server only).
 *
 * Two kinds of test:
 * - new_campaign: built from scratch. Every ad in its campaigns is a test ad; the campaign is
 *   compared with the platform's other campaigns over the same days.
 * - change: new ads (or another change) in an established campaign. The test ads are the ones
 *   picked, or else every ad first seen on or after the live date; they're compared with the
 *   campaign's other ads over the same days, and the campaign with itself before the test.
 * The account (platform and all platforms) since going live vs the same number of days before is
 * context, not proof.
 */

export type TestKind = "new_campaign" | "change"
export const TEST_KINDS: Record<TestKind, { label: string; hint: string }> = {
  new_campaign: { label: "New campaign", hint: "Built from scratch: new campaign, assets or content piece" },
  change: { label: "Change to a campaign", hint: "New creatives, copy or targeting in an established campaign or ad group" },
}

export type Totals = { spend: number; impressions: number; clicks: number; conversions: number; leads: number }
export const ZERO: Totals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0 }
export const add = (a: Totals, b: Totals): Totals => ({ spend: a.spend + b.spend, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, conversions: a.conversions + b.conversions, leads: a.leads + b.leads })
export const minus = (a: Totals, b: Totals): Totals => ({ spend: Math.max(0, a.spend - b.spend), impressions: Math.max(0, a.impressions - b.impressions), clicks: Math.max(0, a.clicks - b.clicks), conversions: Math.max(0, a.conversions - b.conversions), leads: Math.max(0, a.leads - b.leads) })
export const resultsOf = (t: Totals) => t.conversions + t.leads

/** The success metric's value for a set of totals (null when it can't be worked out yet). */
export function metricValue(metric: string, t: Totals): number | null {
  const results = resultsOf(t)
  if (metric === "cost_per_result") return results > 0 ? t.spend / results : null
  if (metric === "cpc") return t.clicks > 0 ? t.spend / t.clicks : null
  if (metric === "ctr") return t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null
  if (metric === "results") return results
  return null
}

/** How much better (positive) or worse (negative) `now` is than `then`, as a fraction, for this metric. */
export function improvement(metric: string, now: number | null, then: number | null): number | null {
  if (now === null || then === null || then === 0) return null
  const change = (now - then) / then
  return METRICS[metric]?.lowerIsBetter ? -change : change
}

export type Period = { from: string; to: string; days: number }

export type TestAd = {
  platform: string
  external_account_id: string
  ad_id: string
  campaign_id: string
  name: string
  first_seen: string | null
  totals: Totals
}

export type Comparison = {
  /** What's being measured, e.g. "The test ads". */
  label: string
  /** What it's compared with, e.g. "the campaign's other ads, same days". */
  against: string
  now: Totals
  then: Totals | null
}

export type VerdictKind = "too_early" | "working" | "not_yet" | "hurting"
export const VERDICTS: Record<VerdictKind, { label: string; tone: "na" | "green" | "amber" | "red" }> = {
  too_early: { label: "Too early", tone: "na" },
  working: { label: "Working", tone: "green" },
  not_yet: { label: "Not yet", tone: "amber" },
  hurting: { label: "Hurting", tone: "red" },
}
export type Verdict = { kind: VerdictKind; reason: string }

export type TestDetail = {
  kind: TestKind
  /** True when nobody said which kind it is and the app worked it out. */
  kindGuessed: boolean
  /** The metric judged: the test's success metric, or cost per result. */
  metric: string
  target: number | null
  live: Period
  before: Period
  /** The test campaigns a day, from the start of the "before" period. */
  daily: { date: string; spend: number; results: number }[]
  testAds: TestAd[]
  otherAds: TestAd[]
  /** True when the test ads were picked by hand (change tests). */
  adsPicked: boolean
  testAdsTotals: Totals
  comparisons: Comparison[]
  verdict: Verdict
}

/** Minimum data before a verdict (Dean, 2026-09-30): 7 days live and one target cost per result of spend. */
export const MIN_DAYS = 7

export function verdictFor(o: { metric: string; target: number | null; days: number; spend: number; targetCpr: number | null; now: number | null; baseline: number | null; fmt: (v: number) => string; money: (v: number) => string }): Verdict {
  const needDays = Math.max(0, MIN_DAYS - o.days)
  const needSpend = o.targetCpr ? Math.max(0, o.targetCpr - o.spend) : 0
  if (needDays > 0 || needSpend > 0) {
    const bits = [needDays > 0 && `${needDays} more day${needDays === 1 ? "" : "s"}`, needSpend > 0 && `${o.money(needSpend)} more spend`].filter(Boolean)
    return { kind: "too_early", reason: `Needs ${bits.join(" and ")} before we judge it.` }
  }
  const def = METRICS[o.metric]
  if (o.now === null) return { kind: o.metric === "cost_per_result" ? "hurting" : "not_yet", reason: o.metric === "cost_per_result" ? `No results yet after ${o.money(o.spend)}.` : "Not enough data for the metric yet." }
  const vsBaseline = improvement(o.metric, o.now, o.baseline)
  const meetsTarget = o.target === null ? null : def?.lowerIsBetter ? o.now <= o.target : o.now >= o.target
  const baselineText = vsBaseline === null ? "" : ` ${Math.abs(Math.round(vsBaseline * 100))}% ${vsBaseline >= 0 ? "better" : "worse"} than before.`
  if (meetsTarget === true || (meetsTarget === null && vsBaseline !== null && vsBaseline >= 0.1)) {
    return { kind: "working", reason: `${def?.label ?? "Metric"} ${o.fmt(o.now)}${o.target !== null ? `, on target (${o.fmt(o.target)})` : ""}.${baselineText}` }
  }
  if (vsBaseline !== null && vsBaseline <= -0.2) return { kind: "hurting", reason: `${def?.label ?? "Metric"} ${o.fmt(o.now)}.${baselineText}` }
  return { kind: "not_yet", reason: `${def?.label ?? "Metric"} ${o.fmt(o.now)}${o.target !== null ? ` vs target ${o.fmt(o.target)}` : ""}.${baselineText}` }
}
