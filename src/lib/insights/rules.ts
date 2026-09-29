/**
 * The "Optimise now" rules (Performance phase 3). Pure functions: no database or network access.
 * Thresholds confirmed by Dean (2026-09-29), including the refinements added in phase 3. Each insight carries `items`
 * (search terms, companies, a week...) so that done / dismissed can hide what was handled while
 * anything new brings the insight back (see applyActions).
 */
import { money as fmtMoney } from "@/lib/format"
import { addDays } from "@/lib/metrics/ads"
import type { Platform } from "@/lib/metrics/types"

export type Sums = { spend: number; impressions: number; clicks: number; results: number }
export type Severity = "high" | "medium" | "low"
export type Category = "waste" | "opportunity" | "problem" | "audience"
export type InsightPlatform = Platform | "ga4"

export type RuleKey =
  | "negatives" | "keywords" | "budget_capped" | "rank_lost" | "no_spend" | "ctr_up" | "high_cpl" | "no_results"
  | "li_own_company" | "li_companies" | "li_weak_segments" | "li_strong_segments" | "li_junior"
  | "meta_frequency" | "meta_learning" | "meta_placements" | "meta_ages" | "meta_lookalike"
  | "landing_pages"
  | "li_not_icp" | "icp_terms"

/** `campaigns`: where the item was seen (LinkedIn companies); `flag`: a short warning shown beside it. */
/** `campaigns`: where the item was seen (LinkedIn companies); `flag`: a short tag beside it, `flagTone` its colour. */
export type InsightItem = { id: string; label: string; note?: string; spend?: number; flag?: string; flagTone?: "bad" | "good" | "warn"; reason?: string; campaigns?: string[] }
export type Insight = {
  key: string
  rule: RuleKey
  category: Category
  severity: Severity
  platform: InsightPlatform
  campaignId: string | null
  campaignName: string | null
  title: string
  why: string
  /** What to do about it, in a sentence. */
  todo: string
  numbers: { label: string; value: string; tone?: "bad" | "good" }[]
  /** Listed items (search terms, companies...) can be copied and handled one by one. */
  items: InsightItem[]
  listed: boolean
  itemsLabel?: string
  /** Money at stake: spend wasted, or spend behind the problem. For ranking. */
  atStake: number | null
  /** An ad preview to show (ad insights). */
  ad?: { platform: Platform; external_account_id: string; ad_id: string }
}

/** What each rule looks for, shown under "Why am I seeing this?". */
export const RULES: Record<RuleKey, { label: string; rule: string }> = {
  negatives: { label: "Negative keywords", rule: "Search terms that spent 2× the target cost per result with no conversions in the last 30 days (brand terms and the campaign's own keywords are left out)." },
  keywords: { label: "Keyword opportunities", rule: "Search terms with 2+ conversions in the last 30 days that aren't keywords in the campaign yet." },
  budget_capped: { label: "Lost to budget", rule: "Search impression share lost to budget above 10% (last 14 days) while the campaign's cost per result is under target." },
  rank_lost: { label: "Lost to rank", rule: "Search impression share lost to rank above 30% (last 14 days)." },
  no_spend: { label: "Stopped spending", rule: "No spend in the last 2 days on a campaign that spent in the week before." },
  ctr_up: { label: "CTR up", rule: "Ad CTR up 30% or more, last 7 days against the 7 before, with 1,000+ impressions in both." },
  high_cpl: { label: "High cost per result", rule: "Campaign cost per result over the last 7 days above 1.5× target (or no results after spending 1.5× target), or above 1.5× its own average for the 30 days before." },
  no_results: { label: "No results", rule: "No conversions or leads in the last 14 days after spending at least the target cost per result." },
  li_own_company: { label: "Own staff", rule: "The client's own company (or ours) among the companies LinkedIn showed the ads to (last 30 days)." },
  li_companies: { label: "Companies to check", rule: "Companies whose people clicked the ads in the last 30 days, to check against the ICP and exclude the ones that don't fit." },
  li_weak_segments: { label: "Audiences to exclude", rule: "job functions, industries or seniorities with 10%+ of a campaign's spend and under half its CTR (1,000+ impressions)." },
  li_strong_segments: { label: "Audiences to include", rule: "job functions, industries or seniorities with 1.5× a campaign's CTR or better (1,000+ impressions)." },
  li_junior: { label: "Junior audience", rule: "Entry, Training and Unpaid seniorities together take 10%+ of a campaign's impressions." },
  meta_frequency: { label: "High frequency", rule: "Ad set frequency above 4 over the last 7 days." },
  meta_learning: { label: "Stuck in learning", rule: "Ad sets that are learning limited, or still learning every day for a week." },
  meta_placements: { label: "Placements", rule: "Placements that spent the target cost per result with no results while the campaign converts, or cost 2× the campaign's cost per result (last 30 days)." },
  meta_ages: { label: "Age groups", rule: "Age groups that spent the target cost per result with no results while the campaign converts, or cost 2× the campaign's cost per result (last 30 days)." },
  meta_lookalike: { label: "Lookalike", rule: "100+ Meta results in the last 90 days, enough people to seed a lookalike audience." },
  li_not_icp: { label: "Not ICP", rule: "LinkedIn companies that clicked in the last 30 days and don't fit the ICP in the client brief, as judged by Claude's daily review." },
  icp_terms: { label: "Off-ICP search terms", rule: "Search terms with spend and no conversions in the last 30 days that don't fit what the client sells or who it sells to, as judged by Claude's daily review (the client brief)." },
  landing_pages: { label: "Landing pages", rule: "paid search landing pages with 100+ sessions in 30 days and under half the average engagement rate, or no conversions where 2+ were expected." },
}

/** `status`: the campaign's current status in the platform (campaign_statuses), when we have it. */
export type CampaignDays = { platform: Platform; campaignId: string; name: string; status?: string | null; daily: ({ date: string } & Sums)[] }
export type AdPair = { platform: Platform; external_account_id: string; campaignId: string; campaignName: string; adId: string; adName: string; last7: Sums; prev7: Sums }
export type TermRow = { campaignId: string; campaignName: string; term: string; spend: number; impressions: number; clicks: number; results: number; isKeyword: boolean }
export type ShareDay = { campaignId: string; campaignName: string; date: string; lostBudget: number | null; lostRank: number | null }
export type SegmentRow = { campaignId: string; campaignName: string; value: string; value2?: string; group?: string; m: Sums; extra?: Record<string, unknown> | null }
export type LinkedInKind = "li_company" | "li_job_title" | "li_seniority" | "li_industry" | "li_job_function"
export type LandingRow = { page: string; sourceMedium: string; sessions: number; engaged: number; conversions: number }

export type InsightInputs = {
  clientName: string
  currency: string
  target: number | null
  /** The last day with data, per platform (a lagging account mustn't look like "stopped spending"). */
  dataThrough: Partial<Record<Platform, string>>
  campaigns: CampaignDays[] // the last 90 days
  ads: AdPair[]
  terms: TermRow[] // 30 days, candidates only (see search_term_candidates)
  share: ShareDay[] // 14 days
  metaAdsets: (SegmentRow & { adsetName: string; reach: number | null; frequency: number | null; learning: string | null })[] // last 7 days, one total
  metaLearningDays: { adsetId: string; date: string; learning: string | null }[] // daily, last 7 days
  metaAges: SegmentRow[] // 30 days, value = age
  metaPlacements: SegmentRow[] // 30 days, value = publisher, value2 = position
  linkedin: Partial<Record<LinkedInKind, { asOf: string; rows: SegmentRow[] }>>
  landing: LandingRow[] // 30 days, paid search only
  /** GA4's last day, when the client has GA4 connected. */
  ga4Through?: string | null
  /** Claude's latest daily review (phase 4): ICP verdicts and campaign goals. */
  review?: ReviewVerdicts | null
  /** Search terms with spend and no conversions (30 days), for the ICP check. */
  costlyTerms?: TermRow[]
}

export type ReviewVerdicts = {
  companies: { name: string; fit: "icp" | "not_icp" | "unsure"; reason: string }[]
  terms: { campaign_id: string; term: string; fit: "relevant" | "clash" | "unsure"; reason: string }[]
  goals: { platform: Platform; campaign_id: string; goal: string; note: string }[]
}

// ---- helpers ------------------------------------------------------------------------------

const Z = (): Sums => ({ spend: 0, impressions: 0, clicks: 0, results: 0 })
const plus = (a: Sums, b: Sums): Sums => ({ spend: a.spend + b.spend, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, results: a.results + b.results })
const sumOf = (list: Sums[]) => list.reduce(plus, Z())
const cpr = (s: Sums) => (s.results > 0 ? s.spend / s.results : null)
const ctr = (s: Sums) => (s.impressions > 0 ? s.clicks / s.impressions : null)
const pct = (v: number | null, digits = 0) => (v === null ? "–" : `${(v * 100).toFixed(digits)}%`)
const intl = (v: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(v)
const round1 = (v: number) => (Math.round(v * 10) / 10).toString()

/** The Monday of the week a date falls in: state-type insights come back once a week at most. */
export const weekOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return addDays(iso, -((d.getUTCDay() + 6) % 7))
}

/**
 * The campaign's goal from its name (Dean: always read the campaign name to understand the goal).
 * Awareness campaigns aren't judged on cost per result. The Notion brief comes in with Claude (phase 4).
 */
/** Goals that aren't judged on cost per result. */
const AWARENESS = ["awareness", "engagement"]

/** A campaign's goal: Claude's read of its name, Notion briefs and the client brief when we have it, otherwise the name. */
export function isAwareness(input: Pick<InsightInputs, "review">, platform: Platform, campaignId: string, name: string) {
  const g = input.review?.goals.find((x) => x.platform === platform && x.campaign_id === campaignId)
  return g ? AWARENESS.includes(g.goal) : goalOf(name) === "awareness"
}

export function goalOf(name: string): "awareness" | "results" {
  return /aware|awareness|\breach\b|video[-_ ]?views?|thought[-_ ]?leader|engagement|\btofu\b|brand[-_ ]?lift/i.test(name) ? "awareness" : "results"
}

const span = (c: CampaignDays, from: string, to: string) => sumOf(c.daily.filter((d) => d.date >= from && d.date <= to))

// ---- the rules ------------------------------------------------------------------------------

/** Statuses that mean the campaign is off on purpose (Dean: a paused campaign isn't "stopped spending"). */
const RUNNING = new Set(["ENABLED", "ACTIVE", "IN_PROCESS", "WITH_ISSUES"])
export const isPaused = (status: string | null | undefined) => Boolean(status) && !RUNNING.has(status!.toUpperCase())

/**
 * The last day whose numbers look complete for a platform. Windsor's latest day is often partial
 * (Google especially), so a day with under 30% of the average spend of the 7 days before it is
 * treated as not in yet (at most 3 days back).
 */
export function completeThrough(campaigns: CampaignDays[], platform: Platform, through: string) {
  const total = (date: string) => campaigns.filter((c) => c.platform === platform).reduce((s, c) => s + (c.daily.find((d) => d.date === date)?.spend ?? 0), 0)
  let day = through
  for (let step = 0; step < 3; step++) {
    const avg = Array.from({ length: 7 }, (_, n) => total(addDays(day, -(n + 1)))).reduce((a, b) => a + b, 0) / 7
    if (avg <= 0 || total(day) >= 0.3 * avg) break
    day = addDays(day, -1)
  }
  return day
}

/** Each platform's last complete day (see completeThrough): what the rules actually judge up to. */
export const effectiveThrough = (input: InsightInputs): Partial<Record<Platform, string>> =>
  Object.fromEntries(Object.entries(input.dataThrough).map(([p, d]) => [p, completeThrough(input.campaigns, p as Platform, d!)]))

/** Something to capitalise on: shown first, in its own section, with a lime dot and border (Dean). */
export const isOpportunity = (i: Pick<Insight, "category" | "rule">) => i.category === "opportunity" || i.rule === "li_strong_segments"

export function computeInsights(raw: InsightInputs): Insight[] {
  const out: Insight[] = []
  const input: InsightInputs = { ...raw, dataThrough: effectiveThrough(raw) }
  const { target, currency } = input
  const money = (v: number) => fmtMoney(v, currency, Math.abs(v) < 10 && v !== 0 ? 2 : 0)
  // Brand terms (with the client's name in them) are never negative candidates.
  const brandWords = input.clientName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
  const isBrand = (term: string) => brandWords.some((w) => term.toLowerCase().includes(w))
  const nameOf = new Map(input.campaigns.map((c) => [`${c.platform}|${c.campaignId}`, c.name]))

  // Google search terms.
  const termsBy = new Map<string, TermRow[]>()
  for (const t of input.terms) termsBy.set(t.campaignId, [...(termsBy.get(t.campaignId) ?? []), t])
  for (const [campaignId, terms] of termsBy) {
    const campaignName = nameOf.get(`google_ads|${campaignId}`) ?? terms[0].campaignName
    if (target) {
      const neg = terms.filter((t) => t.results === 0 && t.spend >= 2 * target && !t.isKeyword && !isBrand(t.term)).sort((a, b) => b.spend - a.spend)
      if (neg.length) {
        const spent = neg.reduce((s, t) => s + t.spend, 0)
        out.push({
          key: `negatives:google_ads:${campaignId}`,
          rule: "negatives",
          category: "waste",
          severity: spent >= 5 * target ? "high" : "medium",
          platform: "google_ads",
          campaignId,
          campaignName,
          title: `${neg.length} search term${neg.length === 1 ? "" : "s"} to add as negatives`,
          why: `${neg.length === 1 ? "It" : "They"} spent ${money(spent)} in 30 days with no conversions: each one at least 2× the ${money(target)} target.`,
          todo: "Check each term against what the campaign sells, then add the irrelevant ones as negative keywords (exact match for one-off terms).",
          numbers: [
            { label: "Spent, no conversions", value: money(spent), tone: "bad" },
            { label: "Terms", value: String(neg.length) },
          ],
          items: neg.map((t) => ({ id: t.term, label: t.term, spend: t.spend, note: `${money(t.spend)} · ${intl(t.clicks)} clicks · 0 conv.` })),
          listed: true,
          itemsLabel: "Search terms",
          atStake: spent,
        })
      }
    }
    const kw = terms.filter((t) => t.results >= 2 && !t.isKeyword).sort((a, b) => b.results - a.results)
    if (kw.length) {
      const results = kw.reduce((s, t) => s + t.results, 0)
      out.push({
        key: `keywords:google_ads:${campaignId}`,
        rule: "keywords",
        category: "opportunity",
        severity: results >= 10 ? "high" : "medium",
        platform: "google_ads",
        campaignId,
        campaignName,
        title: `${kw.length} converting search term${kw.length === 1 ? "" : "s"} to add as keywords`,
        why: `${round1(results)} conversions in 30 days from search terms the campaign doesn't target directly.`,
        todo: "Add them as exact or phrase match keywords (their own ad group if they're a new theme), so you control the bid and the ad copy.",
        numbers: [
          { label: "Conversions", value: round1(results), tone: "good" },
          { label: "Cost per conversion", value: money(kw.reduce((s, t) => s + t.spend, 0) / results) },
        ],
        items: kw.map((t) => ({ id: t.term, label: t.term, spend: t.spend, note: `${round1(t.results)} conv. · ${money(t.spend)}${t.results ? ` · ${money(t.spend / t.results)} each` : ""}` })),
        listed: true,
        itemsLabel: "Search terms",
        atStake: null,
      })
    }
  }

  // Search terms Claude's daily review says don't fit the ICP (the client brief), per campaign.
  if (input.review?.terms.length && input.costlyTerms?.length) {
    const clash = new Map(input.review.terms.filter((t) => t.fit === "clash").map((t) => [`${t.campaign_id}|${t.term}`, t.reason]))
    const flaggedAsNegative = new Set(out.filter((i) => i.rule === "negatives").flatMap((i) => i.items.map((x) => `${i.campaignId}|${x.id}`)))
    const byCampaign = new Map<string, TermRow[]>()
    for (const t of input.costlyTerms) {
      const k = `${t.campaignId}|${t.term}`
      if (clash.has(k) && !flaggedAsNegative.has(k)) byCampaign.set(t.campaignId, [...(byCampaign.get(t.campaignId) ?? []), t])
    }
    for (const [campaignId, terms] of byCampaign) {
      const spent = terms.reduce((s, t) => s + t.spend, 0)
      out.push({
        key: `icp_terms:google_ads:${campaignId}`,
        rule: "icp_terms",
        category: "waste",
        severity: target && spent >= 3 * target ? "high" : target && spent >= target ? "medium" : "low",
        platform: "google_ads",
        campaignId,
        campaignName: nameOf.get(`google_ads|${campaignId}`) ?? terms[0].campaignName,
        title: `${terms.length} search term${terms.length === 1 ? "" : "s"} that don't fit the ICP`,
        why: `${money(spent)} in 30 days with no conversions, on searches Claude judged off-target for what the client sells and who it sells to.`,
        todo: "Check the reasons, then add the ones you agree with as negative keywords.",
        numbers: [
          { label: "Spent, no conversions", value: money(spent), tone: "bad" },
          { label: "Terms", value: String(terms.length) },
        ],
        items: terms.sort((a, b) => b.spend - a.spend).map((t) => ({ id: t.term, label: t.term, spend: t.spend, reason: clash.get(`${t.campaignId}|${t.term}`), note: `${money(t.spend)} · ${intl(t.clicks)} clicks · 0 conv.` })),
        listed: true,
        itemsLabel: "Search terms",
        atStake: spent,
      })
    }
  }

  // Google impression share (the last 14 days).
  const shareBy = new Map<string, ShareDay[]>()
  for (const s of input.share) shareBy.set(s.campaignId, [...(shareBy.get(s.campaignId) ?? []), s])
  for (const [campaignId, days] of shareBy) {
    const campaign = input.campaigns.find((c) => c.platform === "google_ads" && c.campaignId === campaignId)
    const through = input.dataThrough.google_ads
    if (!campaign || !through) continue
    const last14 = span(campaign, addDays(through, -13), through)
    if (last14.spend <= 0) continue
    const avg = (vals: (number | null)[]) => {
      const v = vals.filter((x): x is number => x !== null)
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
    }
    const budget = avg(days.map((d) => d.lostBudget))
    const rank = avg(days.map((d) => d.lostRank))
    const last30 = span(campaign, addDays(through, -29), through)
    const cost = cpr(last30)
    const week = weekOf(through)
    if (budget !== null && budget > 0.1 && target && cost !== null && cost < target) {
      out.push({
        key: `budget_capped:google_ads:${campaignId}`,
        rule: "budget_capped",
        category: "opportunity",
        severity: budget > 0.25 ? "high" : "medium",
        platform: "google_ads",
        campaignId,
        campaignName: campaign.name,
        title: `Missing ${pct(budget)} of searches for budget, at ${money(cost)} a result`,
        why: `It's under the ${money(target)} target, so more budget should buy more results at a good price.`,
        todo: "Raise the daily budget, or move budget here from a campaign that's over target.",
        numbers: [
          { label: "Lost to budget", value: pct(budget), tone: "bad" },
          { label: "Cost per result (30 days)", value: money(cost), tone: "good" },
          { label: "Spend (14 days)", value: money(last14.spend) },
        ],
        items: [{ id: week, label: week }],
        listed: false,
        atStake: last14.spend * budget,
      })
    }
    if (rank !== null && rank > 0.3) {
      out.push({
        key: `rank_lost:google_ads:${campaignId}`,
        rule: "rank_lost",
        category: "problem",
        severity: rank > 0.5 ? "high" : "medium",
        platform: "google_ads",
        campaignId,
        campaignName: campaign.name,
        title: `Losing ${pct(rank)} of searches to Ad Rank`,
        why: `Over the last 14 days the ads missed ${pct(rank)} of the searches they could show on because of bids or quality${budget !== null ? `, and ${pct(budget)} because of budget` : ""}.`,
        todo: "Look at the keywords' quality scores (ad relevance, landing page experience, expected CTR), then bids. More budget won't fix this.",
        numbers: [
          { label: "Lost to rank", value: pct(rank), tone: "bad" },
          { label: "Lost to budget", value: pct(budget) },
          { label: "Spend (14 days)", value: money(last14.spend) },
        ],
        items: [{ id: week, label: week }],
        listed: false,
        atStake: last14.spend * rank,
      })
    }
  }

  // Campaign-level spend and results.
  for (const c of input.campaigns) {
    const through = input.dataThrough[c.platform]
    if (!through) continue
    const last2 = span(c, addDays(through, -1), through)
    const weekBefore = span(c, addDays(through, -8), addDays(through, -2))
    // Paused, removed, archived or completed campaigns are off on purpose: ignore them.
    if (last2.spend === 0 && weekBefore.spend > 0 && !isPaused(c.status)) {
      const lastSpend = c.daily.filter((d) => d.spend > 0).map((d) => d.date).sort().at(-1) ?? ""
      out.push({
        key: `no_spend:${c.platform}:${c.campaignId}`,
        rule: "no_spend",
        category: "problem",
        // Small campaigns coming to their end date matter less than a big one going dark.
        severity: target && weekBefore.spend < 0.25 * target ? "low" : target && weekBefore.spend < target ? "medium" : "high",
        platform: c.platform,
        campaignId: c.campaignId,
        campaignName: c.name,
        title: "Stopped spending",
        why: `It spent ${money(weekBefore.spend)} in the week before and nothing since ${lastSpend} (data to ${through}). ${
          c.status ? `It's still ${c.status.toLowerCase().replace(/_/g, " ")} in the platform, so something else stopped it.` : "We couldn't confirm its status in the platform."
        }`,
        todo: c.status?.toUpperCase() === "WITH_ISSUES" ? "Meta reports issues with this campaign: open it in Ads Manager and fix what it flags." : "Check the budget, end date, bid strategy, disapproved ads and billing.",
        numbers: [
          { label: "Spend, the week before", value: money(weekBefore.spend) },
          { label: "Last spend", value: lastSpend },
          { label: "Status", value: c.status ? c.status.charAt(0) + c.status.slice(1).toLowerCase().replace(/_/g, " ") : "Unknown" },
        ],
        items: [{ id: lastSpend, label: lastSpend }],
        listed: false,
        atStake: weekBefore.spend,
      })
    }
    if (!target || isAwareness(input, c.platform, c.campaignId, c.name)) continue
    const week = weekOf(through)
    const last7 = span(c, addDays(through, -6), through)
    const before30 = span(c, addDays(through, -36), addDays(through, -7))
    const cost7 = cpr(last7)
    const cost30 = cpr(before30)
    const last14 = span(c, addDays(through, -13), through)
    const noResults14 = last14.results === 0 && last14.spend >= target
    // A week with no results at all, after more than 1.5x target, is over target too (unless the
    // 14-day "no results" insight below already covers it).
    const emptyWeek = last7.results === 0 && last7.spend > 1.5 * target && !noResults14
    if (emptyWeek || (cost7 !== null && (cost7 > 1.5 * target || (cost30 !== null && cost7 > 1.5 * cost30)))) {
      const overTarget = emptyWeek || cost7! > 1.5 * target
      const ratio = emptyWeek ? last7.spend / target : cost7! / target
      out.push({
        key: `high_cpl:${c.platform}:${c.campaignId}`,
        rule: "high_cpl",
        category: "problem",
        severity: ratio > 2 ? "high" : overTarget ? "medium" : "low",
        platform: c.platform,
        campaignId: c.campaignId,
        campaignName: c.name,
        title: emptyWeek ? `No results this week after ${money(last7.spend)}` : `Cost per result ${money(cost7!)} this week`,
        why: emptyWeek
          ? `${round1(ratio)}× the ${money(target)} target spent in the last 7 days without a conversion or lead${cost30 !== null ? ` (${money(cost30)} per result over the 30 days before)` : ""}.`
          : overTarget
            ? `${round1(ratio)}× the ${money(target)} target over the last 7 days${cost30 !== null ? ` (${money(cost30)} over the 30 days before)` : ""}.`
            : `${round1(cost7! / cost30!)}× its own ${money(cost30!)} average for the 30 days before, though still under the ${money(target)} target.`,
        todo: "Use \"Why did it move?\" on the campaign: is it fewer conversions per click (landing page, audience, tracking) or dearer clicks (competition, CTR)?",
        numbers: [
          { label: "Cost per result (7 days)", value: emptyWeek ? "no results" : money(cost7!), tone: "bad" },
          { label: "Spend (7 days)", value: money(last7.spend) },
          { label: "30 days before", value: cost30 === null ? "–" : money(cost30) },
          { label: "Target", value: money(target) },
        ],
        items: [{ id: week, label: week }],
        listed: false,
        atStake: last7.spend,
      })
    }
    if (noResults14) {
      out.push({
        key: `no_results:${c.platform}:${c.campaignId}`,
        rule: "no_results",
        category: "problem",
        severity: last14.spend >= 2 * target ? "high" : "medium",
        platform: c.platform,
        campaignId: c.campaignId,
        campaignName: c.name,
        title: `No results in 14 days after ${money(last14.spend)}`,
        why: `It has spent ${round1(last14.spend / target)}× the ${money(target)} target cost per result without a conversion or lead.`,
        todo: "Check conversion tracking first (tag firing, the right conversion action), then the audience, offer and landing page.",
        numbers: [
          { label: "Spend (14 days)", value: money(last14.spend), tone: "bad" },
          { label: "Clicks", value: intl(last14.clicks) },
          { label: "CTR", value: pct(ctr(last14), 2) },
        ],
        items: [{ id: week, label: week }],
        listed: false,
        atStake: last14.spend,
      })
    }
  }

  // Ads whose CTR jumped.
  for (const a of input.ads) {
    if (a.last7.impressions < 1000 || a.prev7.impressions < 1000 || a.last7.clicks < 10) continue
    const now = ctr(a.last7)!
    const before = ctr(a.prev7)!
    if (before <= 0 || now < before * 1.3) continue
    out.push({
      key: `ctr_up:${a.platform}:${a.external_account_id}:${a.adId}`,
      rule: "ctr_up",
      category: "opportunity",
      severity: "low",
      platform: a.platform,
      campaignId: a.campaignId,
      campaignName: a.campaignName,
      title: `CTR up ${Math.round((now / before - 1) * 100)}% on "${a.adName}"`,
      why: `${pct(before, 2)} → ${pct(now, 2)}, last 7 days against the 7 before, on ${intl(a.last7.impressions)} impressions.`,
      todo: "Find out what's landing (message, format, audience, placement), use it in the next variant, and give this ad more of the budget if results follow.",
      numbers: [
        { label: "CTR, last 7 days", value: pct(now, 2), tone: "good" },
        { label: "CTR, 7 before", value: pct(before, 2) },
        { label: "Results, last 7 days", value: round1(a.last7.results) },
      ],
      items: [{ id: a.adId, label: a.adName }],
      listed: false,
      atStake: null,
      ad: { platform: a.platform, external_account_id: a.external_account_id, ad_id: a.adId },
    })
  }

  out.push(...linkedinInsights(input, money), ...metaInsights(input, money), ...landingInsights(input))
  return out
}

function linkedinInsights(input: InsightInputs, money: (v: number) => string): Insight[] {
  const out: Insight[] = []
  const li = input.linkedin

  // Companies: our client's own staff (or ours) seeing the ads, then everyone who clicked.
  const companies = li.li_company
  if (companies) {
    const byCompany = new Map<string, { m: Sums; campaigns: Set<string> }>()
    for (const r of companies.rows) {
      const e = byCompany.get(r.value) ?? { m: Z(), campaigns: new Set<string>() }
      e.m = plus(e.m, r.m)
      e.campaigns.add(r.campaignName)
      byCompany.set(r.value, e)
    }
    // Which campaigns each company saw; seeing several is flagged (Dean), since each needs the exclusion.
    const companyItem = (n: string, e: { m: Sums; campaigns: Set<string> }, note: string): InsightItem => ({
      id: n,
      label: n,
      spend: e.m.spend,
      note,
      campaigns: [...e.campaigns].sort(),
      flag: e.campaigns.size > 1 ? `${e.campaigns.size} campaigns` : undefined,
    })
    const clientWords = input.clientName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length >= 4)
    const own = [...byCompany].filter(([name]) => {
      const n = name.toLowerCase()
      return clientWords.some((w) => n.includes(w)) || /bordeaux\s*(&|and)\s*burgundy/.test(n)
    })
    if (own.length) {
      const spent = own.reduce((s, [, e]) => s + e.m.spend, 0)
      out.push({
        key: "li_own_company:linkedin",
        rule: "li_own_company",
        category: "waste",
        severity: "medium",
        platform: "linkedin",
        campaignId: null,
        campaignName: null,
        title: "Our own people are seeing the ads",
        why: `${own.map(([n]) => n).join(", ")} got ${intl(own.reduce((s, [, e]) => s + e.m.impressions, 0))} impressions${spent ? ` (${money(spent)})` : ""} in the 30 days to ${companies.asOf}.`,
        todo: "Add them to the company exclusions on the campaigns listed under each one.",
        numbers: [{ label: "Impressions", value: intl(own.reduce((s, [, e]) => s + e.m.impressions, 0)), tone: "bad" }],
        items: own.map(([n, e]) => companyItem(n, e, `${intl(e.m.impressions)} impr. · ${intl(e.m.clicks)} clicks`)),
        listed: true,
        itemsLabel: "Companies",
        atStake: spent,
      })
    }
    const verdict = new Map((input.review?.companies ?? []).map((v) => [v.name, v]))
    const clickedAll = [...byCompany].filter(([n, e]) => e.m.clicks > 0 && !own.some(([o]) => o === n)).sort((a, b) => b[1].m.clicks - a[1].m.clicks || b[1].m.spend - a[1].m.spend)
    // Claude's daily review judged these against the ICP in the client brief: the misfits get their own insight.
    const notIcp = clickedAll.filter(([n]) => verdict.get(n)?.fit === "not_icp")
    if (notIcp.length) {
      const spent = notIcp.reduce((s, [, e]) => s + e.m.spend, 0)
      out.push({
        key: "li_not_icp:linkedin",
        rule: "li_not_icp",
        category: "waste",
        severity: notIcp.length >= 5 || spent >= (input.target ?? 200) ? "medium" : "low",
        platform: "linkedin",
        campaignId: null,
        campaignName: null,
        title: `${notIcp.length} compan${notIcp.length === 1 ? "y" : "ies"} that don't fit the ICP clicked the ads`,
        why: `Claude checked every company that clicked in the 30 days to ${companies.asOf} against the ICP in the client brief. These don't fit${spent ? ` (${money(spent)} on them)` : ""}.`,
        todo: "Check the reasons, then add them to the company exclusions on the campaigns listed under each one.",
        numbers: [
          { label: "Companies", value: intl(notIcp.length), tone: "bad" },
          { label: "Their clicks", value: intl(notIcp.reduce((s, [, e]) => s + e.m.clicks, 0)) },
        ],
        items: notIcp.map(([n, e]) => ({ ...companyItem(n, e, `${intl(e.m.clicks)} click${e.m.clicks === 1 ? "" : "s"} · ${intl(e.m.impressions)} impr.`), reason: verdict.get(n)!.reason, flag: e.campaigns.size > 1 ? `${e.campaigns.size} campaigns` : undefined })),
        listed: true,
        itemsLabel: "Companies",
        atStake: spent,
      })
    }
    const clicked = clickedAll.filter(([n]) => verdict.get(n)?.fit !== "not_icp")
    if (clicked.length) {
      out.push({
        key: "li_companies:linkedin",
        rule: "li_companies",
        category: "audience",
        severity: "low",
        platform: "linkedin",
        campaignId: null,
        campaignName: null,
        title: input.review ? `${clicked.length} other compan${clicked.length === 1 ? "y" : "ies"} clicked` : `${clicked.length} companies clicked: check them against the ICP`,
        why: `Who interacted with the ads in the 30 days to ${companies.asOf}, most clicks first. Companies that aren't a fit can be excluded in Campaign Manager.`,
        todo: "Check them against the ICP (Brain tab), select the ones that don't fit, copy them and add them to the campaigns' company exclusions in Campaign Manager.",
        numbers: [
          { label: "Companies that clicked", value: intl(clicked.length) },
          { label: "Their clicks", value: intl(clicked.reduce((s, [, e]) => s + e.m.clicks, 0)) },
        ],
        items: clicked.slice(0, 150).map(([n, e]) => {
          const v = verdict.get(n)
          const item = companyItem(n, e, `${intl(e.m.clicks)} click${e.m.clicks === 1 ? "" : "s"} · ${intl(e.m.impressions)} impr.`)
          return v?.fit === "icp" ? { ...item, reason: v.reason, flag: item.flag ?? "ICP fit", flagTone: item.flag ? item.flagTone : ("good" as const) } : v ? { ...item, reason: v.reason } : item
        }),
        listed: true,
        itemsLabel: "Companies",
        atStake: null,
      })
    }
  }

  // Segments per campaign: weak ones to exclude, strong ones to lean into, and junior seniorities.
  const KIND_LABEL: Partial<Record<LinkedInKind, string>> = { li_job_function: "Job function", li_industry: "Industry", li_seniority: "Seniority" }
  const perCampaign = new Map<string, { name: string; rows: { kind: LinkedInKind; r: SegmentRow }[] }>()
  for (const kind of ["li_job_function", "li_industry", "li_seniority"] as LinkedInKind[]) {
    for (const r of li[kind]?.rows ?? []) {
      const e = perCampaign.get(r.campaignId) ?? { name: r.campaignName, rows: [] }
      e.rows.push({ kind, r })
      perCampaign.set(r.campaignId, e)
    }
  }
  const asOf = li.li_seniority?.asOf ?? li.li_job_function?.asOf ?? ""
  for (const [campaignId, { name, rows }] of perCampaign) {
    const seniority = rows.filter((x) => x.kind === "li_seniority").map((x) => x.r)
    const total = sumOf(seniority.map((r) => r.m)) // one full split of the campaign
    if (total.impressions < 1000) continue
    const campaignCtr = ctr(total)!
    const label = (x: { kind: LinkedInKind; r: SegmentRow }) => `${KIND_LABEL[x.kind]}: ${x.r.value}`
    const big = rows.filter((x) => x.r.m.impressions >= 1000)
    const weak = big.filter((x) => total.spend > 0 && x.r.m.spend >= 0.1 * total.spend && (ctr(x.r.m) ?? 0) < 0.5 * campaignCtr)
    const strong = big.filter((x) => (ctr(x.r.m) ?? 0) >= 1.5 * campaignCtr && x.r.m.clicks >= 10)
    const item = (x: { kind: LinkedInKind; r: SegmentRow }) => ({ id: `${x.kind}:${x.r.value}`, label: label(x), spend: x.r.m.spend, note: `CTR ${pct(ctr(x.r.m), 2)} vs ${pct(campaignCtr, 2)} · ${money(x.r.m.spend)} · ${intl(x.r.m.impressions)} impr.` })
    if (weak.length) {
      const spent = weak.reduce((s, x) => s + x.r.m.spend, 0)
      out.push({
        key: `li_weak_segments:linkedin:${campaignId}`,
        rule: "li_weak_segments",
        category: "audience",
        severity: spent >= 0.3 * total.spend ? "medium" : "low",
        platform: "linkedin",
        campaignId,
        campaignName: name,
        title: `${weak.length} audience${weak.length === 1 ? "" : "s"} taking spend with a weak CTR`,
        why: `Together ${money(spent)} (${pct(spent / total.spend)} of the campaign) in the 30 days to ${asOf}, at under half the campaign's ${pct(campaignCtr, 2)} CTR. LinkedIn doesn't report conversions by audience, so this is on CTR.`,
        todo: "If they're outside the campaign's goal and the ICP, exclude them (or narrow the targeting) and let the budget go to the audiences that engage.",
        numbers: [
          { label: "Their spend", value: money(spent), tone: "bad" },
          { label: "Campaign CTR", value: pct(campaignCtr, 2) },
        ],
        items: weak.sort((a, b) => b.r.m.spend - a.r.m.spend).map(item),
        listed: true,
        itemsLabel: "Audiences",
        atStake: spent,
      })
    }
    if (strong.length) {
      out.push({
        key: `li_strong_segments:linkedin:${campaignId}`,
        rule: "li_strong_segments",
        category: "audience",
        severity: "low",
        platform: "linkedin",
        campaignId,
        campaignName: name,
        title: `${strong.length} audience${strong.length === 1 ? "" : "s"} engaging well above the rest`,
        why: `1.5× the campaign's ${pct(campaignCtr, 2)} CTR or better, in the 30 days to ${asOf}.`,
        todo: "Consider their own campaign (own budget, tailored message), and check whether other campaigns with the same goal are missing them.",
        numbers: [{ label: "Campaign CTR", value: pct(campaignCtr, 2) }],
        items: strong.sort((a, b) => (ctr(b.r.m) ?? 0) - (ctr(a.r.m) ?? 0)).map(item),
        listed: true,
        itemsLabel: "Audiences",
        atStake: null,
      })
    }
    const junior = seniority.filter((r) => /^(entry|training|unpaid)/i.test(r.value))
    const juniorM = sumOf(junior.map((r) => r.m))
    if (junior.length && juniorM.impressions >= 0.1 * total.impressions) {
      out.push({
        key: `li_junior:linkedin:${campaignId}`,
        rule: "li_junior",
        category: "audience",
        severity: juniorM.impressions >= 0.2 * total.impressions ? "medium" : "low",
        platform: "linkedin",
        campaignId,
        campaignName: name,
        title: `${pct(juniorM.impressions / total.impressions)} of impressions are entry level or trainees`,
        why: `${junior.map((r) => r.value).join(", ")}: ${money(juniorM.spend)} in the 30 days to ${asOf}. They rarely buy B2B software.`,
        todo: "Unless the campaign is meant for them, exclude these seniorities (or set a seniority filter).",
        numbers: [
          { label: "Share of impressions", value: pct(juniorM.impressions / total.impressions), tone: "bad" },
          { label: "Their spend", value: money(juniorM.spend) },
        ],
        items: junior.map((r) => ({ id: r.value, label: r.value, spend: r.m.spend, note: `${intl(r.m.impressions)} impr. · ${money(r.m.spend)}` })),
        listed: true,
        itemsLabel: "Seniorities",
        atStake: juniorM.spend,
      })
    }
  }
  return out
}

function metaInsights(input: InsightInputs, money: (v: number) => string): Insight[] {
  const out: Insight[] = []
  const through = input.dataThrough.meta
  if (!through) return out
  const week = weekOf(through)
  const { target } = input

  for (const a of input.metaAdsets) {
    if (a.m.spend < 0.25 * (target ?? 200)) continue // too small to matter
    if (a.frequency !== null && a.frequency > 4) {
      out.push({
        key: `meta_frequency:meta:${a.value}`,
        rule: "meta_frequency",
        category: "problem",
        severity: a.frequency > 6 ? "high" : "medium",
        platform: "meta",
        campaignId: a.campaignId,
        campaignName: a.campaignName,
        title: `Frequency ${a.frequency.toFixed(1)} on "${a.adsetName}"`,
        why: `Each person saw the ads ${a.frequency.toFixed(1)} times in the last 7 days (${intl(a.reach ?? 0)} people). Fatigue and rising costs usually follow.`,
        todo: "Broaden the audience, add fresh creative, or lower the budget. For small retargeting pools, cap the budget.",
        numbers: [
          { label: "Frequency (7 days)", value: a.frequency.toFixed(1), tone: "bad" },
          { label: "Reach", value: intl(a.reach ?? 0) },
          { label: "Spend", value: money(a.m.spend) },
        ],
        items: [{ id: week, label: week }],
        listed: false,
        atStake: a.m.spend,
      })
    }
    const days = input.metaLearningDays.filter((d) => d.adsetId === a.value)
    const limited = a.learning === "FAIL"
    const stuck = days.length >= 7 && days.every((d) => d.learning === "LEARNING")
    if (limited || stuck) {
      out.push({
        key: `meta_learning:meta:${a.value}`,
        rule: "meta_learning",
        category: "problem",
        severity: "medium",
        platform: "meta",
        campaignId: a.campaignId,
        campaignName: a.campaignName,
        title: limited ? `"${a.adsetName}" is learning limited` : `"${a.adsetName}" has been learning all week`,
        why: `It isn't getting the ~50 optimisation events a week Meta needs to leave learning (${round1(a.m.results)} results in the last 7 days on ${money(a.m.spend)}).`,
        todo: "Consolidate ad sets, broaden the audience, raise the budget, or optimise for an earlier, more frequent event.",
        numbers: [
          { label: "Results (7 days)", value: round1(a.m.results) },
          { label: "Spend (7 days)", value: money(a.m.spend) },
        ],
        items: [{ id: week, label: week }],
        listed: false,
        atStake: a.m.spend,
      })
    }
  }

  // Placements and age groups that cost a lot more than the rest of the campaign (30 days).
  const skew = (rows: SegmentRow[], rule: "meta_placements" | "meta_ages", label: (r: SegmentRow) => string) => {
    if (!target) return
    const byCampaign = new Map<string, SegmentRow[]>()
    for (const r of rows) byCampaign.set(r.campaignId, [...(byCampaign.get(r.campaignId) ?? []), r])
    for (const [campaignId, list] of byCampaign) {
      const name = list[0].campaignName
      if (isAwareness(input, "meta", campaignId, name)) continue
      // Age rows come per gender: add them up per age first.
      const merged = new Map<string, SegmentRow>()
      for (const r of list) {
        const id = label(r)
        const e = merged.get(id)
        merged.set(id, e ? { ...e, m: plus(e.m, r.m) } : r)
      }
      const segs = [...merged.entries()]
      const total = sumOf(segs.map(([, r]) => r.m))
      const campaignCost = cpr(total)
      if (campaignCost === null) continue // judged against a campaign that converts
      const bad = segs.filter(([, r]) => (r.m.results === 0 && r.m.spend >= target) || (r.m.results > 0 && r.m.spend >= target && cpr(r.m)! >= 2 * campaignCost))
      if (!bad.length) continue
      const spent = bad.reduce((s, [, r]) => s + r.m.spend, 0)
      const noun = rule === "meta_ages" ? "age group" : "placement"
      out.push({
        key: `${rule}:meta:${campaignId}`,
        rule,
        category: "audience",
        severity: spent >= 0.25 * total.spend ? "medium" : "low",
        platform: "meta",
        campaignId,
        campaignName: name,
        title: `${bad.length} ${noun}${bad.length === 1 ? "" : "s"} costing far more than the rest`,
        why: `${money(spent)} in 30 days with no results or at 2× the campaign's ${money(campaignCost)} cost per result.`,
        todo: rule === "meta_ages" ? "Narrow the age range, or split out the ages that convert." : "Exclude these placements (turn off Advantage+ placements for this ad set), or give them their own creative.",
        numbers: [
          { label: "Their spend", value: money(spent), tone: "bad" },
          { label: "Campaign cost per result", value: money(campaignCost) },
        ],
        items: bad
          .sort((a, b) => b[1].m.spend - a[1].m.spend)
          .map(([id, r]) => ({ id, label: id, spend: r.m.spend, note: r.m.results ? `${money(cpr(r.m)!)} per result · ${money(r.m.spend)}` : `${money(r.m.spend)} · no results` })),
        listed: true,
        itemsLabel: rule === "meta_ages" ? "Age groups" : "Placements",
        atStake: spent,
      })
    }
  }
  skew(input.metaPlacements, "meta_placements", (r) => `${r.value}${r.value2 ? ` · ${r.value2}` : ""}`.replace(/_/g, " "))
  skew(input.metaAges, "meta_ages", (r) => r.value)

  const meta90 = sumOf(input.campaigns.filter((c) => c.platform === "meta").map((c) => span(c, addDays(through, -89), through)))
  if (meta90.results >= 100) {
    const month = through.slice(0, 7)
    out.push({
      key: "meta_lookalike:meta",
      rule: "meta_lookalike",
      category: "opportunity",
      severity: "low",
      platform: "meta",
      campaignId: null,
      campaignName: null,
      title: "Enough leads to seed a lookalike audience",
      why: `${intl(meta90.results)} Meta results in 90 days. A lookalike of the people behind your highest-intent event (MQLs, demo requests) finds more like them.`,
      todo: "Build a 1% lookalike from the high-intent event (or a CRM list of MQLs), and test it against the current prospecting audience.",
      numbers: [{ label: "Results (90 days)", value: intl(meta90.results), tone: "good" }],
      items: [{ id: month, label: month }],
      listed: false,
      atStake: null,
    })
  }
  return out
}

function landingInsights(input: InsightInputs): Insight[] {
  const pages = new Map<string, LandingRow>()
  for (const r of input.landing) {
    const page = r.page.split("?")[0] || "/"
    const e = pages.get(page)
    pages.set(page, e ? { ...e, sessions: e.sessions + r.sessions, engaged: e.engaged + r.engaged, conversions: e.conversions + r.conversions } : { ...r, page })
  }
  const list = [...pages.values()]
  const sessions = list.reduce((s, p) => s + p.sessions, 0)
  if (sessions < 100) return []
  const avgEngagement = list.reduce((s, p) => s + p.engaged, 0) / sessions
  const avgCvr = list.reduce((s, p) => s + p.conversions, 0) / sessions
  const weak = list.filter((p) => p.sessions >= 100 && (p.engaged / p.sessions < 0.5 * avgEngagement || (p.conversions === 0 && p.sessions * avgCvr >= 2)))
  if (!weak.length) return []
  return [
    {
      key: "landing_pages:ga4",
      rule: "landing_pages",
      category: "problem",
      severity: "medium",
      platform: "ga4",
      campaignId: null,
      campaignName: null,
      title: `${weak.length} paid search landing page${weak.length === 1 ? "" : "s"} underperforming`,
      why: `Against the paid search average of ${pct(avgEngagement)} engaged sessions and ${pct(avgCvr, 1)} converting, over the last 30 days (GA4).`,
      todo: "Check the ad-to-page message match, page speed on mobile and the form. Try sending the traffic to a better page.",
      numbers: [
        { label: "Avg engagement rate", value: pct(avgEngagement) },
        { label: "Avg conversion rate", value: pct(avgCvr, 1) },
      ],
      items: weak
        .sort((a, b) => b.sessions - a.sessions)
        .map((p) => ({ id: p.page, label: p.page, note: `${intl(p.sessions)} sessions · ${pct(p.engaged / p.sessions)} engaged · ${round1(p.conversions)} conv.` })),
      listed: true,
      itemsLabel: "Landing pages",
      atStake: null,
    },
  ]
}

// ---- what the team did with them ----------------------------------------------------------------

export type LoggedAction = { insight_key: string; action: "done" | "dismissed" | "snoozed" | "briefed" | "tested" | "reopened"; items: string[]; snooze_until: string | null; created_at: string; note?: string | null; notion_page_id?: string | null; sprint_test_id?: string | null; profile_name?: string | null }
export type FeedInsight = Insight & {
  /** Items still to handle (all of them when nothing was handled). */
  open: InsightItem[]
  handledCount: number
  state: "open" | "in_hand" | "snoozed" | "closed"
  snoozedUntil: string | null
  history: LoggedAction[]
  /** Claude's place for it in the daily review (1 = first), and why now. */
  claude?: { rank: number; whyNow: string } | null
}

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 }
/** Highest severity first, then the most money at stake. */
export const priority = (i: Insight) => SEVERITY_WEIGHT[i.severity] * 1e9 + (i.atStake ?? 0)

/**
 * Applies the log to the computed insights. Done / dismissed hide the items they covered (an empty
 * list covers them all); a snooze hides the insight until its date; briefed / tested move it to "in
 * hand"; "reopened" cancels everything before it.
 */
export function applyActions(insights: Insight[], log: LoggedAction[], today: string): FeedInsight[] {
  const byKey = new Map<string, LoggedAction[]>()
  for (const a of [...log].sort((x, y) => x.created_at.localeCompare(y.created_at))) byKey.set(a.insight_key, [...(byKey.get(a.insight_key) ?? []), a])
  return insights
    .map((i) => {
      const all = byKey.get(i.key) ?? []
      const lastReopen = all.map((a) => a.action).lastIndexOf("reopened")
      const live = all.slice(lastReopen + 1)
      const closed = new Set<string>()
      let closedAll = false
      for (const a of live.filter((a) => a.action === "done" || a.action === "dismissed")) {
        if (!a.items.length) closedAll = true
        a.items.forEach((x) => closed.add(x))
      }
      const inHand = new Set<string>()
      let inHandAll = false
      for (const a of live.filter((a) => a.action === "briefed" || a.action === "tested")) {
        if (!a.items.length) inHandAll = true
        a.items.forEach((x) => inHand.add(x))
      }
      const open = closedAll ? [] : i.items.filter((x) => !closed.has(x.id))
      const snooze = live.filter((a) => a.action === "snoozed" && a.snooze_until && a.snooze_until > today).at(-1)
      const notInHand = inHandAll ? [] : open.filter((x) => !inHand.has(x.id))
      const state: FeedInsight["state"] = !open.length ? "closed" : snooze ? "snoozed" : !notInHand.length ? "in_hand" : "open"
      return { ...i, open, handledCount: i.items.length - open.length, state, snoozedUntil: snooze?.snooze_until ?? null, history: all }
    })
    .sort((a, b) => priority(b) - priority(a))
}

/**
 * Changes whenever the rules' code changes, so a cached feed from older rules is never shown (the
 * cache key includes it; on Vercel the data cache outlives a deploy).
 */
export const RULES_FINGERPRINT = codeFingerprint(computeInsights, linkedinInsights, metaInsights, landingInsights, completeThrough, goalOf, isAwareness)

/** A short hash of some functions' source code. */
export function codeFingerprint(...fns: ((...args: never[]) => unknown)[]) {
  let h = 5381
  for (const ch of fns.map(String).join("\n")) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
  return (h >>> 0).toString(36)
}
