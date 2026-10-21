import { describe, expect, it } from "vitest"
import { checkFacts, type PlaybookRule } from "@/lib/campaign-builder/guardrails"
import { googleSteps, metaSteps, microsoftSteps } from "./plan-platforms"
import { checkGoogle, checkMeta, checkMicrosoft, metaFacts, metaTargeting, searchFacts } from "./spec-platforms"
import type { BuildContext } from "./spec"

const ctx: BuildContext = { website: "https://www.dnsfilter.com", monthBudget: 30_000, spentThisMonth: 18_000, today: "2026-10-21", clientId: "c1" }

const ad = {
  headlines: ["DNS Filtering for MSPs", "Block Threats at DNS", "Try It Free for 14 Days", "Set Up in 5 Minutes", "Trusted by 20,000 Orgs", "No Hardware Needed", "AI Threat Detection", "Built for MSPs"],
  descriptions: ["Protect every client network from one dashboard.", "Start a free trial today. No card needed."],
  finalUrl: "https://www.dnsfilter.com/msp",
  path1: "msp",
}
const google = {
  campaign: { name: "DG | Search | MSP", bidding: "maximize_conversions", dailyBudget: 150, locations: [{ id: 2840, name: "United States" }], languages: ["en"] },
  adGroups: [{ name: "MSP DNS filtering", keywords: [{ text: "dns filtering for msp", match: "PHRASE" }, { text: "msp dns filter", match: "EXACT" }], ads: [ad] }],
  sitelinks: [{ text: "Free trial", finalUrl: "https://www.dnsfilter.com/trial", description1: "14 days free", description2: "No card needed" }],
  callouts: ["Set up in minutes"],
}

const meta = {
  pageId: "699339163533807",
  campaign: { name: "DNSF | Meta | MSP leads", objective: "OUTCOME_LEADS" },
  adSet: {
    name: "MSP | US | Lookalike",
    dailyBudget: 120,
    startDate: "2026-10-26",
    optimizationGoal: "LEAD_GENERATION",
    targeting: {
      baseAdSetId: "120250304395470484",
      base: { geo_locations: { countries: ["GB"], location_types: ["home", "recent"] }, custom_audiences: [{ id: "111", name: "Lookalike" }], publisher_platforms: ["facebook", "audience_network"], flexible_spec: [{ interests: [{ id: "6003", name: "IT" }] }] },
      countries: ["US"],
      customAudiences: [{ id: "222", name: "Trial signups" }],
      excludedAudiences: [{ id: "333", name: "Customers" }],
    },
  },
  ads: [{ name: "MSP ad 1", message: "Protect every client network.", headline: "DNS filtering for MSPs", link: "https://www.dnsfilter.com/msp", imagePath: "c1/abc.png", leadFormId: "987" }],
}

describe("Google Ads builds", () => {
  it("accept a sound Search build and warn about networks", () => {
    const r = checkGoogle(google, ctx)
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toMatch(/Search Partners/)
  })
  it("refuse long headlines, '!', duplicates and landing pages off the site", () => {
    const bad = { ...google, adGroups: [{ ...google.adGroups[0], ads: [{ ...ad, headlines: ["This headline is far too long for Google", "Free!", "Free!"], finalUrl: "https://example.com" }] }] }
    expect(checkGoogle(bad, ctx).ok).toBe(false)
    const r = checkGoogle({ ...google, adGroups: [{ ...google.adGroups[0], ads: [{ ...ad, headlines: ["Free!", "Free!", "Try it"], finalUrl: "https://example.com" }] }] }, ctx)
    expect(r.errors.join(" ")).toMatch(/same/)
    expect(r.errors.join(" ")).toMatch(/"!"/)
    expect(r.errors.join(" ")).toMatch(/landing page/)
  })
  it("need a max CPC on manual bidding", () => {
    expect(checkGoogle({ ...google, campaign: { ...google.campaign, bidding: "manual_cpc" } }, ctx).errors.join()).toMatch(/max CPC/)
  })
  it("refuse a daily budget over the month's budget", () => {
    expect(checkGoogle({ ...google, campaign: { ...google.campaign, dailyBudget: 2000 } }, ctx).errors.join()).toMatch(/adds up to/)
  })
  it("send the campaign paused, then locations, languages, ad groups, keywords, ads and extensions", () => {
    const steps = googleSteps(checkGoogle(google, ctx).spec!)
    expect(steps.map((s) => s.key)).toEqual(["campaign", "locations", "languages", "ad_group:0", "keywords:0", "ad:0:0", "sitelink:0", "callout:0"])
    const ids = { campaign: "11", "ad_group:0": "22" }
    expect(steps[0].payload(ids)).toMatchObject({ budget_amount_micros: 150_000_000, status: "paused", channel_type: "search" })
    expect(steps[1].payload(ids)).toEqual({ campaign_id: "11", locations: [{ geo_target_constant_id: "2840" }] })
    expect(steps[3].payload(ids)).toMatchObject({ campaign_id: "11", status: "paused" })
    expect(steps[4].payload(ids)).toMatchObject({ ad_group_id: "22", keywords: [{ text: "dns filtering for msp", match_type: "PHRASE" }, { text: "msp dns filter", match_type: "EXACT" }] })
    expect(steps[5].payload(ids)).toMatchObject({ ad_group_id: "22", final_url: ad.finalUrl, path1: "msp", status: "paused" })
    expect(steps[6].payload(ids)).toMatchObject({ asset_type: "sitelink", level: "campaign", campaign_id: "11", description_1: "14 days free" })
  })
})

describe("Microsoft Ads builds", () => {
  const microsoft = { campaign: { ...google.campaign, bidding: "MaxConversions", locations: [{ id: 190, name: "United States" }], languages: ["English"] }, adGroups: google.adGroups }
  it("accept a Search build with the unverified warning", () => {
    const r = checkMicrosoft(microsoft, ctx)
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toMatch(/unverified/)
  })
  it("send paused bodies in Microsoft's shape", () => {
    const steps = microsoftSteps(checkMicrosoft(microsoft, ctx).spec!, "GBP")
    const ids = { campaign: "11", "ad_group:0": "22" }
    expect(steps[0].payload(ids)).toMatchObject({ Campaigns: [{ Status: "Paused", DailyBudget: 150, TimeZone: "GreenwichMeanTimeDublinEdinburghLisbonLondon" }] })
    expect(steps[1].payload(ids)).toMatchObject({ CriterionType: "Targets", CampaignCriterions: [{ CampaignId: "11", Criterion: { LocationId: 190 } }] })
    expect(steps.find((s) => s.key === "keywords:0")!.payload(ids)).toMatchObject({ AdGroupId: "22", Keywords: [{ MatchType: "Phrase" }, { MatchType: "Exact" }] })
    expect(steps.find((s) => s.key === "ad:0:0")!.payload(ids)).toMatchObject({ Ads: [{ Type: "ResponsiveSearch", Status: "Paused", FinalUrls: [ad.finalUrl] }] })
  })
})

describe("Meta builds", () => {
  it("accept a lead ad build", () => {
    const r = checkMeta(meta, ctx)
    expect(r.errors).toEqual([])
    expect(r.spec?.adSet.targeting.audienceNetwork).toBe(false)
  })
  it("need an instant form on lead ads, a pixel on conversions and the client's own images", () => {
    expect(checkMeta({ ...meta, ads: [{ ...meta.ads[0], leadFormId: undefined }] }, ctx).errors.join()).toMatch(/instant form/)
    expect(checkMeta({ ...meta, adSet: { ...meta.adSet, optimizationGoal: "OFFSITE_CONVERSIONS" }, ads: [{ ...meta.ads[0], leadFormId: undefined }] }, ctx).errors.join()).toMatch(/pixel/)
    expect(checkMeta({ ...meta, ads: [{ ...meta.ads[0], imagePath: "c2/x.png" }] }, ctx).errors.join()).toMatch(/another client/)
  })
  it("refuse an audience that's both in and out, and a base ad set that wasn't read", () => {
    const t = meta.adSet.targeting
    expect(checkMeta({ ...meta, adSet: { ...meta.adSet, targeting: { ...t, excludedAudiences: [{ id: "222" }] } } }, ctx).errors.join()).toMatch(/both included and excluded/)
    expect(checkMeta({ ...meta, adSet: { ...meta.adSet, targeting: { ...t, base: undefined } } }, ctx).errors.join()).toMatch(/couldn't be read/)
  })
  it("start from the base ad set, keep its audiences and interests, and set placements and Advantage+ explicitly", () => {
    const t = metaTargeting(checkMeta(meta, ctx).spec!.adSet.targeting)
    expect(t.geo_locations).toEqual({ countries: ["US"], location_types: ["home"] })
    expect(t.custom_audiences).toEqual([{ id: "111" }, { id: "222" }])
    expect(t.excluded_custom_audiences).toEqual([{ id: "333" }])
    expect(t.flexible_spec).toEqual(meta.adSet.targeting.base.flexible_spec)
    expect(t.publisher_platforms).toEqual(["facebook", "instagram"])
    expect(t.targeting_automation).toEqual({ advantage_audience: 0 })
  })
  it("send a paused campaign, ad set and lead ads that open the form", () => {
    const steps = metaSteps(checkMeta(meta, ctx).spec!)
    const ids = { campaign: "1", ad_set: "2" }
    expect(steps[0].payload(ids)).toMatchObject({ objective: "OUTCOME_LEADS", status: "paused" })
    expect(steps[1].payload(ids)).toMatchObject({ campaign_id: "1", daily_budget: 12_000, destination_type: "ON_AD", promoted_object: { page_id: meta.pageId }, status: "paused" })
    expect(steps[2].payload(ids)).toMatchObject({ adset_id: "2", image_path: "c1/abc.png", status: "paused", creative: { object_story_spec: { link_data: { call_to_action: { value: { lead_gen_form_id: "987" } } } } } })
  })
  it("use a custom conversion by name, a standard event by type", () => {
    const conv = (event: string) => metaSteps(checkMeta({ ...meta, adSet: { ...meta.adSet, optimizationGoal: "OFFSITE_CONVERSIONS", pixel: { pixelId: "300", event } }, ads: [{ ...meta.ads[0], leadFormId: undefined }] }, ctx).spec!)[1].payload({ campaign: "1" })
    expect(conv("Lead").promoted_object).toEqual({ pixel_id: "300", custom_event_type: "LEAD" })
    expect(conv("Sales Qualified Opportunity").promoted_object).toEqual({ pixel_id: "300", custom_event_type: "OTHER", custom_event_str: "Sales Qualified Opportunity" })
  })
})

describe("guardrails on every platform", () => {
  const rule = (field: string, op: string, value?: number): PlaybookRule => ({ id: field, platform: "x", client_id: null, kind: "guardrail", modes: ["general"], title: field, body: "", check_rule: { field, op, value } as PlaybookRule["check_rule"] })
  it("check Google headlines and Meta's Audience Network", () => {
    expect(checkFacts(searchFacts(checkGoogle(google, ctx).spec!), [rule("headlineLength", "max", 20)]).length).toBeGreaterThan(0)
    const on = checkMeta({ ...meta, adSet: { ...meta.adSet, targeting: { ...meta.adSet.targeting, audienceNetwork: true } } }, ctx).spec!
    expect(checkFacts(metaFacts(on), [rule("audienceNetwork", "forbid")])).toHaveLength(1)
    expect(checkFacts(metaFacts(checkMeta(meta, ctx).spec!), [rule("audienceNetwork", "forbid"), rule("bid", "max", 1)])).toEqual([])
  })
})
