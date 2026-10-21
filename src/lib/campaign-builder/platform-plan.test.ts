import { describe, expect, it } from "vitest"
import { checkGoogle, checkMeta } from "@/lib/ads-api/spec-platforms"
import { checkReddit } from "@/lib/ads-api/spec"
import { draftToSpec, knownLocation, platformPlan } from "./platform-plan"

const ctx = { website: "https://www.dnsfilter.com", monthBudget: 30_000, spentThisMonth: 0, today: "2026-10-21", clientId: "c1" }
const why = { summary: "MSPs searching for DNS filtering, to free trials." }

describe("platform plans", () => {
  it("turn a Google draft into a spec, leaving incomplete ads and Display out", () => {
    const p = platformPlan.parse({
      ...why,
      platform: "google_ads",
      draft: {
        campaign: { name: "DG | Search | MSP", dailyBudget: 150, locations: [{ id: 2840, name: "United States" }] },
        adGroups: [
          { name: "MSP", keywords: [{ text: "msp dns filter", match: "EXACT" }], ads: [{ headlines: ["DNS Filtering for MSPs", "Block Threats", "Try It Free"], descriptions: ["Protect every client.", "Free trial."], finalUrl: "https://www.dnsfilter.com/msp" }, { headlines: ["Only one"], descriptions: [] }] },
        ],
        notBuilt: [{ name: "Retargeting", format: "Display" }],
      },
    })
    const r = draftToSpec(p)
    expect(r.missing).toEqual([])
    expect(r.leftOut).toHaveLength(2)
    expect(checkGoogle(r.spec, ctx).errors).toEqual([])
  })
  it("say what's missing: a location id, keywords, a landing page", () => {
    const p = platformPlan.parse({ ...why, platform: "google_ads", draft: { campaign: { name: "x", dailyBudget: 10, locations: [{ name: "Ontario" }] }, adGroups: [{ name: "g", ads: [{ headlines: ["a", "b", "c"], descriptions: ["d", "e"] }] }] } })
    const r = draftToSpec(p)
    expect(r.spec).toBeNull()
    expect(r.missing.join(" ")).toMatch(/Ontario/)
    expect(r.missing.join(" ")).toMatch(/keywords/)
    expect(r.missing.join(" ")).toMatch(/landing page/)
  })
  it("need a page and images for Meta, and leave video for Ads Manager", () => {
    const draft = {
      campaign: { name: "Meta | MSP", objective: "OUTCOME_TRAFFIC" },
      adSet: { name: "US", dailyBudget: 50, startDate: "2026-10-26", optimizationGoal: "LANDING_PAGE_VIEWS", targeting: { countries: ["US"] } },
      ads: [
        { name: "Image", message: "Protect clients.", headline: "DNS for MSPs", link: "https://www.dnsfilter.com/msp", imagePath: "c1/a.png" },
        { name: "Video", format: "video" },
      ],
    }
    expect(draftToSpec(platformPlan.parse({ ...why, platform: "meta", draft })).missing.join()).toMatch(/Facebook page/)
    const r = draftToSpec(platformPlan.parse({ ...why, platform: "meta", draft: { ...draft, pageId: "699339163533807" } }))
    expect(r.leftOut.join()).toMatch(/video/)
    expect(checkMeta(r.spec, ctx).errors).toEqual([])
  })
  it("need a published post for Reddit ads", () => {
    const draft = { campaign: { name: "Reddit | MSP", objective: "CLICKS" }, adGroup: { name: "r/msp", dailyBudget: 50, startDate: "2026-10-26", targeting: { geolocations: ["US"], communities: ["msp"] } }, ads: [{ name: "Post", headline: "We built DNS filtering for MSPs", clickUrl: "https://www.dnsfilter.com/msp" }] }
    const none = draftToSpec(platformPlan.parse({ ...why, platform: "reddit", draft }))
    expect(none.spec).toBeNull()
    expect(none.leftOut.join()).toMatch(/publish the post/)
    const r = draftToSpec(platformPlan.parse({ ...why, platform: "reddit", draft: { ...draft, ads: [{ ...draft.ads[0], postId: "t3_abc123" }] } }))
    expect(checkReddit(r.spec, ctx).errors).toEqual([])
  })
  it("know the main location ids", () => {
    expect(knownLocation("google_ads", "US")).toBe(2840)
    expect(knownLocation("google_ads", "United Kingdom")).toBe(2826)
    expect(knownLocation("microsoft_ads", "uk")).toBe(188)
    expect(knownLocation("google_ads", "Ontario")).toBeNull()
  })
})
