import { describe, expect, it } from "vitest"
import { linkedInSteps, linkedInTargeting, redditSteps } from "./plan"
import { checkBudget, checkLinkedIn, checkReddit, onClientSite, type BuildContext } from "./spec"

const ctx: BuildContext = { website: "https://www.dnsfilter.com", monthBudget: 30_000, spentThisMonth: 18_000, today: "2026-10-21" }

const linkedIn = {
  organizationId: "1234567",
  group: { name: "Sprint 3 | MSP test", startDate: "2026-10-26" },
  campaign: {
    name: "DNSF | LI | MSP | Single image",
    objective: "WEBSITE_CONVERSION",
    costType: "CPC",
    bid: 12,
    dailyBudget: 200,
    startDate: "2026-10-26",
    locale: { country: "US", language: "en" },
    targeting: { include: { locations: ["urn:li:geo:103644278"], interfaceLocales: ["urn:li:locale:en_US"] }, exclude: { employers: ["urn:li:organization:999"] } },
  },
  ads: [{ name: "MSP ad 1", commentary: "Protect every client network in minutes.", headline: "DNS filtering for MSPs", landingUrl: "https://www.dnsfilter.com/msp", imagePath: "c1/builds/msp.png" }],
}

describe("checks", () => {
  it("accept a sound LinkedIn plan", () => {
    const r = checkLinkedIn(linkedIn, ctx)
    expect(r.errors).toEqual([])
    expect(r.spec?.campaign.offsiteDelivery).toBe(false)
  })
  it("keep landing pages on the client's site", () => {
    expect(onClientSite("https://dnsfilter.com/x", "https://www.dnsfilter.com")).toBe(true)
    expect(onClientSite("https://app.dnsfilter.com", "dnsfilter.com")).toBe(true)
    expect(onClientSite("https://dnsfilter.com.evil.io", "dnsfilter.com")).toBe(false)
    expect(onClientSite("https://dnsfilter.com", null)).toBe(false)
    const r = checkLinkedIn({ ...linkedIn, ads: [{ ...linkedIn.ads[0], landingUrl: "https://example.com" }] }, ctx)
    expect(r.errors.join()).toMatch(/landing page/)
  })
  it("need a location and an interface language on LinkedIn", () => {
    const r = checkLinkedIn({ ...linkedIn, campaign: { ...linkedIn.campaign, targeting: { include: { industries: ["urn:li:industry:4"] } } } }, ctx)
    expect(r.errors).toHaveLength(2)
  })
  it("refuse over the month's budget and warn over what's left", () => {
    // October: 31 days, 11 left on the 21st. 30k for the month.
    const run = (daily: number, spent: number) => {
      const errors: string[] = []
      const warnings: string[] = []
      checkBudget(daily, { ...ctx, spentThisMonth: spent }, errors, warnings)
      return { errors, warnings }
    }
    expect(run(1_000, 0).errors).toHaveLength(1) // 31k a month
    expect(run(900, 18_000)).toEqual({ errors: [], warnings: [] }) // 9.9k left to spend, 12k left
    expect(run(900, 25_000).warnings).toHaveLength(1) // 9.9k against 5k left
    expect(run(100, 0).errors).toEqual([])
    expect(run(100, 0).warnings).toEqual([])
    const noBudget: string[] = []
    checkBudget(100, { ...ctx, monthBudget: null }, [], noBudget)
    expect(noBudget).toHaveLength(1)
  })
  it("refuse a start date in the past", () => {
    const r = checkLinkedIn({ ...linkedIn, campaign: { ...linkedIn.campaign, startDate: "2026-10-01" } }, ctx)
    expect(r.errors.join()).toMatch(/past/)
  })
})

describe("LinkedIn steps", () => {
  const spec = checkLinkedIn(linkedIn, ctx).spec!
  const steps = linkedInSteps(spec, "508073934", "USD")

  it("run group → campaign → image → post → ad", () => {
    expect(steps.map((s) => s.key)).toEqual(["group", "campaign", "image:0", "post:0", "ad:0"])
  })
  it("create the group as DRAFT and everything else PAUSED", () => {
    const ids = { group: "1", campaign: "2", "image:0": "urn:li:image:3", "post:0": "urn:li:share:4" }
    expect(steps[0].payload(ids).status).toBe("DRAFT")
    expect(steps[1].payload(ids).status).toBe("PAUSED")
    expect(steps[4].payload(ids)).toMatchObject({ intendedStatus: "PAUSED", campaign: "urn:li:sponsoredCampaign:2", content: { reference: "urn:li:share:4" } })
  })
  it("chain the ids and keep posts dark", () => {
    const ids = { group: "1", campaign: "2", "image:0": "urn:li:image:3" }
    expect(steps[1].payload(ids)).toMatchObject({ campaignGroup: "urn:li:sponsoredCampaignGroup:1", dailyBudget: { amount: "200", currencyCode: "USD" }, politicalIntent: "NOT_POLITICAL" })
    expect(steps[3].payload(ids)).toMatchObject({ distribution: { feedDistribution: "NONE" }, content: { media: { id: "urn:li:image:3" } } })
  })
  it("use an existing group without creating one", () => {
    const s = linkedInSteps({ ...spec, group: { existingId: "77" } }, "508073934", "USD")
    expect(s[0].key).toBe("campaign")
    expect(s[0].payload({})).toMatchObject({ campaignGroup: "urn:li:sponsoredCampaignGroup:77" })
  })
  it("build LinkedIn's targeting shape", () => {
    expect(linkedInTargeting(spec.campaign.targeting)).toEqual({
      include: { and: [{ or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:103644278"] } }, { or: { "urn:li:adTargetingFacet:interfaceLocales": ["urn:li:locale:en_US"] } }] },
      exclude: { or: { "urn:li:adTargetingFacet:employers": ["urn:li:organization:999"] } },
    })
  })
})

describe("Reddit steps", () => {
  const reddit = {
    campaign: { name: "DNSF | Reddit | MSP", objective: "CONVERSIONS" },
    adGroup: { name: "r/msp", bidStrategy: "MAXIMIZE_VOLUME", bidType: "CPC", dailyBudget: 100, startDate: "2026-10-26", targeting: { geolocations: ["US"], communities: ["msp"] } },
    ads: [{ name: "Ad 1", postId: "t3_abc123", clickUrl: "https://www.dnsfilter.com/msp" }],
  }
  it("check, then run campaign → ad group → ads, all paused, money in micros", () => {
    const r = checkReddit(reddit, ctx)
    expect(r.errors).toEqual([])
    const steps = redditSteps(r.spec!)
    expect(steps.map((s) => s.key)).toEqual(["campaign", "ad_group", "ad:0"])
    expect(steps.every((s) => s.payload({ campaign: "c", ad_group: "g" }).configured_status === "PAUSED")).toBe(true)
    expect(steps[1].payload({ campaign: "c" })).toMatchObject({ campaign_id: "c", goal_value: 100_000_000 })
  })
})
