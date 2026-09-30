import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { money, oneDp } from "@/lib/format"
import { addDays } from "@/lib/metrics/ads"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { rpcAll } from "@/lib/supabase/rpc-all"
import type { SprintTest } from "./data"
import { add, metricValue, verdictFor, ZERO, type Comparison, type TestAd, type TestDetail, type TestKind, type Totals } from "./results"
import { METRICS } from "./tests"

const n = (v: unknown) => Number(v) || 0
const totalsOf = (r: Record<string, unknown>): Totals => ({ spend: n(r.spend), impressions: n(r.impressions), clicks: n(r.clicks), conversions: n(r.conversions), leads: n(r.leads) })
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1

/**
 * Everything the side panel shows for a live test, from Windsor data we already sync daily (see
 * results.ts for the rules). Uses the caller's Supabase client, so RLS applies; the read route
 * passes the admin client after its own access check. Null when there's nothing to measure yet.
 */
export async function loadTestDetail(supabase: SupabaseClient, clientId: string, test: SprintTest, opts: { today: string; currency: string; targetCpr: number | null }): Promise<TestDetail | null> {
  if (!test.live_on || !test.campaign_ids.length) return null
  const liveFrom = test.live_on
  const [ranges, campaignDays] = await Promise.all([
    supabase.from("account_data_range").select("platform, data_through").eq("client_id", clientId),
    rpcAll(supabase, "campaign_daily", { p_client: clientId, p_from: addDays(liveFrom, -90), p_to: opts.today }),
  ])
  const through =
    ((ranges.data ?? []) as { platform: string; data_through: string }[])
      .filter((r) => !test.platform || r.platform === test.platform)
      .map((r) => r.data_through)
      .sort()
      .at(-1) ?? opts.today
  const liveTo = through < liveFrom ? liveFrom : through
  const days = dayCount(liveFrom, liveTo)
  const before = { from: addDays(liveFrom, -days), to: addDays(liveFrom, -1), days }
  const live = { from: liveFrom, to: liveTo, days }

  const inTest = new Set(test.campaign_ids)
  const rows = (campaignDays as Record<string, unknown>[]).filter((r) => !test.platform || r.platform === test.platform)
  const sum = (pred: (r: Record<string, unknown>) => boolean) => rows.filter(pred).reduce<Totals>((a, r) => add(a, totalsOf(r)), ZERO)
  const inRange = (r: Record<string, unknown>, p: { from: string; to: string }) => (r.date as string) >= p.from && (r.date as string) <= p.to
  const campaignNow = sum((r) => inTest.has(r.campaign_id as string) && inRange(r, live))
  const campaignBefore = sum((r) => inTest.has(r.campaign_id as string) && inRange(r, before))
  const othersNow = sum((r) => !inTest.has(r.campaign_id as string) && inRange(r, live))
  // Spend on the test's campaigns more than 3 days before it went live means they were already running.
  const earliest = rows.filter((r) => inTest.has(r.campaign_id as string) && n(r.spend) > 0).map((r) => r.date as string).sort()[0]
  const guessedKind: TestKind = earliest && earliest < addDays(liveFrom, -3) ? "change" : "new_campaign"
  const kind = (test.test_kind as TestKind | null) ?? guessedKind

  // Ads over the live period, with when each was first seen.
  const { data: adRows } = await supabase.rpc("test_ads", { p_client: clientId, p_platform: test.platform, p_campaign_ids: test.campaign_ids, p_from: liveFrom, p_to: liveTo })
  const ads: TestAd[] = ((adRows ?? []) as Record<string, unknown>[]).map((a) => ({
    platform: a.platform as string,
    external_account_id: a.external_account_id as string,
    ad_id: a.ad_id as string,
    campaign_id: a.campaign_id as string,
    name: (a.ad_name as string) || (a.ad_id as string),
    first_seen: (a.first_seen as string) ?? null,
    totals: totalsOf(a),
  }))
  const picked = new Set(test.test_ad_ids ?? [])
  const adsPicked = kind === "change" && picked.size > 0
  const isTestAd = (a: TestAd) => kind === "new_campaign" || (adsPicked ? picked.has(a.ad_id) : Boolean(a.first_seen && a.first_seen >= liveFrom))
  const testAds = ads.filter(isTestAd)
  const otherAds = ads.filter((a) => !isTestAd(a))
  const testAdsTotals = testAds.reduce((a, x) => add(a, x.totals), ZERO)
  const otherAdsTotals = otherAds.reduce((a, x) => add(a, x.totals), ZERO)

  // Account context: the platform, and every platform, since going live vs the days before.
  const { data: acct } = await supabase.rpc("platform_daily", { p_client: clientId, p_from: before.from, p_to: liveTo })
  const acctRows = (acct ?? []) as Record<string, unknown>[]
  const acctSum = (p: { from: string; to: string }, platform?: Platform | null) => acctRows.filter((r) => inRange(r, p) && (!platform || r.platform === platform)).reduce<Totals>((a, r) => add(a, totalsOf(r)), ZERO)

  const platformName = test.platform ? PLATFORM_LABEL[test.platform] : "All platforms"
  const comparisons: Comparison[] = []
  if (kind === "change") {
    if (testAds.length) comparisons.push({ label: "The test ads", against: "the campaign's other ads, same days", now: testAdsTotals, then: otherAds.length ? otherAdsTotals : null })
    comparisons.push({ label: "The campaign", against: `the ${days} days before it went live`, now: campaignNow, then: campaignBefore })
  } else {
    comparisons.push({ label: "The campaign", against: `other ${platformName} campaigns, same days`, now: campaignNow, then: othersNow.spend > 0 ? othersNow : null })
  }
  if (test.platform) comparisons.push({ label: platformName, against: `the ${days} days before`, now: acctSum(live, test.platform), then: acctSum(before, test.platform) })
  comparisons.push({ label: "The whole account", against: `the ${days} days before`, now: acctSum(live), then: acctSum(before) })

  // Daily series for the test's campaigns, from the start of the "before" period.
  const byDate = new Map<string, { spend: number; results: number }>()
  for (const r of rows) {
    if (!inTest.has(r.campaign_id as string) || (r.date as string) < before.from || (r.date as string) > liveTo) continue
    const d = byDate.get(r.date as string) ?? { spend: 0, results: 0 }
    d.spend += n(r.spend)
    d.results += n(r.conversions) + n(r.leads)
    byDate.set(r.date as string, d)
  }
  const daily: TestDetail["daily"] = []
  for (let d = before.from; d <= liveTo; d = addDays(d, 1)) daily.push({ date: d, ...(byDate.get(d) ?? { spend: 0, results: 0 }) })

  // The verdict judges what was changed: the test ads (or the campaign), against the first comparison.
  const metric = test.success_metric && METRICS[test.success_metric] ? test.success_metric : "cost_per_result"
  const target = test.success_metric === metric ? test.success_target : metric === "cost_per_result" ? opts.targetCpr : null
  const primary = comparisons[0]
  const m = (v: number) => money(v, opts.currency)
  const unit = METRICS[metric].unit
  const fmt = (v: number) => (unit === "money" ? m(v) : unit === "percent" ? `${v.toFixed(2)}%` : oneDp(v))
  const verdict = verdictFor({
    metric,
    target,
    days,
    spend: primary.now.spend,
    targetCpr: opts.targetCpr,
    now: metricValue(metric, primary.now),
    baseline: primary.then ? metricValue(metric, primary.then) : null,
    fmt,
    money: m,
  })

  return { kind, kindGuessed: !test.test_kind, metric, target, live, before, daily, testAds, otherAds, adsPicked, testAdsTotals, comparisons, verdict }
}
