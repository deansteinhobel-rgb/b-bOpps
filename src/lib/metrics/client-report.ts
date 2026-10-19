/**
 * The client report (Dean, 2026-10-19): a step-by-step report the team builds and shares with the
 * client. Pick a platform, then a campaign (or all of them), then the dates; it shows the headline
 * numbers, the 3 best and 3 weakest ads, and a summary in plain words. Written for the client: no
 * internal notes. Pure functions (plain module: the app page and the public link both use it).
 */
import { money, percent, whole } from "@/lib/format"
import { median, MIN_RESULTS_FOR_CPR, type AdStat } from "./ads"
import { change, type Derived } from "./performance"
import { PLATFORM_LABEL, type Platform } from "./types"

export type ReportAd = AdStat & { results: number; costPerResult: number | null; ctr: number | null }
export type AdPicks = { byResults: ReportAd[]; byCtr: ReportAd[]; worst: ReportAd[]; worstBasis: "cost_per_result" | "ctr" }

const enrich = (a: AdStat): ReportAd => {
  const results = a.conversions + a.leads
  return { ...a, results, costPerResult: results > 0 ? a.spend / results : null, ctr: a.impressions > 0 ? a.clicks / a.impressions : null }
}

/**
 * The top and weakest ads in the report's scope (Dean, 2026-10-19: the top as 2 for results and 2
 * for click-through rate). Only ads that spent more than the median ad count, so a $5 ad with one
 * lucky lead never tops a list.
 * - For results: the lowest cost per result, ads with 3+ results first, then ads with 1-2.
 * - For click-through rate: the highest CTR among the rest (never an ad already shown for results).
 * - Weakest: by cost per result when at least 2 ads have 3+ results (spent with no results first,
 *   biggest spend first), otherwise the lowest CTR; never an ad already in the top lists.
 */
export function pickAds(ads: AdStat[], top = 2, weak = 3): AdPicks {
  const spent = ads.filter((a) => a.spend > 0)
  const m = median(spent.map((a) => a.spend))
  let eligible = spent.filter((a) => a.spend > m)
  if (eligible.length < 2) eligible = spent
  const list = eligible.map(enrich)
  const byCost = (a: ReportAd, b: ReportAd) => a.costPerResult! - b.costPerResult! || b.results - a.results
  const withResults = list.filter((a) => a.results >= MIN_RESULTS_FOR_CPR)
  const fewer = list.filter((a) => a.results > 0 && a.results < MIN_RESULTS_FOR_CPR)
  const byResults = [...withResults.sort(byCost), ...fewer.sort(byCost)].slice(0, top)
  const used = new Set(byResults.map((a) => a.ad_id))
  const byCtr = list.filter((a) => a.ctr !== null && a.clicks > 0 && !used.has(a.ad_id)).sort((a, b) => b.ctr! - a.ctr! || b.clicks - a.clicks).slice(0, top)
  for (const a of byCtr) used.add(a.ad_id)
  const rest = list.filter((a) => !used.has(a.ad_id))
  // Only call ads weak when there are enough to compare: at most half of the eligible ads.
  const take = Math.min(weak, rest.length, Math.floor(list.length / 2))
  if (withResults.length >= 2) {
    const worst = rest
      .sort((a, b) => {
        const ca = a.costPerResult ?? Infinity
        const cb = b.costPerResult ?? Infinity
        return ca === cb ? b.spend - a.spend : cb - ca
      })
      .slice(0, take)
    return { byResults, byCtr, worst, worstBasis: "cost_per_result" }
  }
  const worst = rest.filter((a) => a.ctr !== null).sort((a, b) => a.ctr! - b.ctr! || b.spend - a.spend).slice(0, take)
  return { byResults, byCtr, worst, worstBasis: "ctr" }
}

export type SummaryCampaign = { platform: Platform; name: string; now: Derived; prev: Derived }
export type SummaryInput = {
  /** What the report covers, e.g. "LinkedIn" or the campaign's name. */
  scope: string
  /** One campaign picked: no campaign-by-campaign lines. */
  oneCampaign: boolean
  platform: Platform | null
  currency: string
  compare: boolean
  now: Derived
  prev: Derived
  /** The cost per result target for this scope, if the client has one. */
  target: number | null
  campaigns: SummaryCampaign[]
  best: ReportAd | null
  basis: "cost_per_result" | "ctr"
}

const pct = (v: number) => `${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}%`
const moved = (now: number | null, prev: number | null, up: string, down: string) => {
  const c = change(now, prev)
  if (c === null) return null
  if (Math.abs(c) < 1) return "about the same as"
  return `${c > 0 ? up : down} ${pct(c)} on`
}
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)
const quote = (name: string) => `“${name}”`

/**
 * What happened in the period, in plain sentences for the client: spend, results and their cost
 * (against the previous period and the target), clicks, which campaigns did the work, what started
 * or stopped, and the strongest ad.
 */
export function reportSummary(s: SummaryInput): string[] {
  const m = (v: number | null, digits = 0) => money(v, s.currency, digits)
  const out: string[] = []
  const before = "the period before"
  const spendMove = s.compare ? moved(s.now.spend, s.prev.spend, "up", "down") : null
  out.push(`${s.scope} spent ${m(s.now.spend)}${spendMove ? `, ${spendMove} ${before}` : ""}.`)

  const leadsMatter = s.platform !== "google_ads" && s.now.leads > 0
  if (s.now.results > 0) {
    const parts = leadsMatter && s.now.conversions > 0 ? ` (${whole(s.now.conversions)} conversions and ${whole(s.now.leads)} leads)` : leadsMatter ? " (all from lead forms)" : ""
    let line = `That brought ${whole(s.now.results)} ${s.now.results === 1 ? "result" : "results"}${parts} at ${m(s.now.cpr)} each`
    const cprMove = s.compare && s.prev.cpr !== null ? change(s.now.cpr, s.prev.cpr) : null
    if (cprMove !== null) line += Math.abs(cprMove) < 1 ? `, about the same cost as before` : `, ${pct(cprMove)} ${cprMove < 0 ? "cheaper" : "more expensive"} than ${before} (${m(s.prev.cpr)})`
    if (s.target && s.now.cpr !== null) line += s.now.cpr <= s.target ? `, within the ${m(s.target)} target` : `, above the ${m(s.target)} target`
    out.push(`${line}.`)
  } else if (s.now.spend > 0) {
    out.push(s.compare && s.prev.results > 0 ? `There were no conversions or leads this time, against ${whole(s.prev.results)} in ${before}.` : "There were no conversions or leads in this period.")
  }

  if (s.now.clicks > 0) {
    const ctrMove = s.compare ? moved(s.now.ctr, s.prev.ctr, "up", "down") : null
    out.push(`People clicked the ads ${whole(s.now.clicks)} times, at ${m(s.now.cpc, 2)} a click, and ${percent(s.now.ctr, 2)} of the people who saw an ad clicked it${ctrMove ? ` (${ctrMove} ${before})` : ""}.`)
  }

  if (!s.oneCampaign) {
    const live = s.campaigns.filter((c) => c.now.spend > 0)
    const top = [...live].filter((c) => c.now.results > 0).sort((a, b) => b.now.results - a.now.results || a.now.spend - b.now.spend)[0]
    if (top && live.length > 1) {
      const share = top.now.results / Math.max(s.now.results, 1)
      out.push(`${quote(top.name)}${s.platform ? "" : ` on ${PLATFORM_LABEL[top.platform]}`} brought the most results: ${whole(top.now.results)}${share < 0.995 ? ` (${Math.round(share * 100)}% of the total)` : ""} at ${m(top.now.cpr)} each.`)
    }
    if (s.compare) {
      const started = live.filter((c) => c.prev.spend === 0).map((c) => quote(c.name))
      const stopped = s.campaigns.filter((c) => c.now.spend === 0 && c.prev.spend > 0).map((c) => quote(c.name))
      if (started.length) out.push(started.length > 4 ? `${started.length} campaigns started running in this period.` : `New in this period: ${list(started)}.`)
      if (stopped.length) out.push(stopped.length > 4 ? `${stopped.length} campaigns that ran before were paused or finished.` : `No longer running: ${list(stopped)}.`)
    }
  }

  if (s.best) {
    const b = s.best
    out.push(
      s.basis === "cost_per_result"
        ? `The strongest ad was ${quote(b.ad_name ?? b.ad_id)}, with ${whole(b.results)} ${b.results === 1 ? "result" : "results"} at ${m(b.costPerResult)} each.`
        : `The ad that drew the most interest was ${quote(b.ad_name ?? b.ad_id)}: ${percent(b.ctr, 2)} of the people who saw it clicked.`,
    )
  }
  return out
}
