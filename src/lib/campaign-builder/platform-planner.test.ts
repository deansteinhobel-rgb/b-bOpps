import { describe, expect, it } from "vitest"
import { normalizePlatformPlan, platformDraftSchema } from "./platform-normalize"
import { platformPlan, type OtherPlatform } from "./platform-plan"
import { PLATFORM_PRESETS, platformPresetByKey, presetsForPlatform } from "./platform-presets"
import type { MetaIds } from "./platform-history"
import type { ProposalSource } from "./plan-schema"

const META: MetaIds = {
  pages: ["699339163533807"],
  pixels: [{ pixelId: "300641693796955", event: "Sales Qualified Opportunity" }],
  adSets: [{ id: "120250304395470484", name: "MSP | Lookalike 1%", campaign: "MSP leads", spend: 1200, results: 9, audience: "US 25-65; lookalikes: LAL 1% leads" }],
}

const why = { summary: "Search for DNS filtering.", rationale: [{ point: "Terms convert", source: "history" }], success: "Under $300 a trial" }

describe("presets", () => {
  it("has presets for every platform, with unique keys", () => {
    for (const p of ["google_ads", "meta", "reddit", "microsoft_ads"] as OtherPlatform[]) expect(presetsForPlatform(p).length).toBeGreaterThan(0)
    expect(new Set(PLATFORM_PRESETS.map((p) => p.key)).size).toBe(PLATFORM_PRESETS.length)
    expect(platformPresetByKey("meta_lead_ads")?.platform).toBe("meta")
    expect(platformPresetByKey("nope")).toBeNull()
  })
  it("has a tool schema for every platform's draft", () => {
    for (const p of ["google_ads", "meta", "reddit", "microsoft_ads"] as OtherPlatform[]) expect(platformDraftSchema(p)).toHaveProperty("properties")
  })
})

describe("normalize: Google", () => {
  const raw = {
    ...why,
    draft: {
      campaign: { name: "DG | Search | DNS Filtering", bidding: "maximize_conversions", dailyBudget: 120, locations: [{ name: "United States", id: 2840 }, { name: "Texas", id: 21176 }, "UK"], languages: ["en"] },
      adGroups: [{ name: "DNS filtering", cpcBid: 0, keywords: [{ text: "dns filtering", match: "exact" }, "dns filter software", { text: "", match: "PHRASE" }], ads: [{ headlines: ["DNS Filtering", " ", "Block Threats"], descriptions: ["Stop threats at the DNS layer.", "Free trial."], finalUrl: "https://www.dnsfilter.com/trial" }] }],
      callouts: ["Free trial", ""],
    },
  }
  const n = normalizePlatformPlan("google_ads", raw, { proposal: null, meta: null })
  const parsed = platformPlan.parse(n)
  it("keeps only location ids we know for that name", () => {
    if (parsed.platform !== "google_ads") throw new Error("platform")
    expect(parsed.draft.campaign.locations).toEqual([{ id: 2840, name: "United States" }, { id: null, name: "Texas" }, { id: 2826, name: "UK" }])
  })
  it("tidies keywords, bids and blank lines", () => {
    if (parsed.platform !== "google_ads") throw new Error("platform")
    const g = parsed.draft.adGroups[0]
    expect(g.cpcBid).toBeNull()
    expect(g.keywords).toEqual([{ text: "dns filtering", match: "EXACT" }, { text: "dns filter software", match: "PHRASE" }])
    expect(g.ads[0].headlines).toEqual(["DNS Filtering", "Block Threats"])
    expect(parsed.draft.callouts).toEqual(["Free trial"])
  })
})

describe("normalize: Meta", () => {
  const proposal: ProposalSource = { pageId: "p", title: "Q4 Meta", url: "https://notion.so/x", images: [{ n: 1, caption: "", path: "c1/a.png", error: null }, { n: 2, caption: "", path: null, error: "WebP" }], problems: [] }
  const raw = {
    ...why,
    draft: {
      pageId: "111",
      campaign: { name: "Meta | Leads", objective: "OUTCOME_LEADS" },
      adSet: { name: "LAL", dailyBudget: 80, startDate: "2026-11-01", optimizationGoal: "OFFSITE_CONVERSIONS", pixel: { pixelId: "300641693796955", event: "Sales Qualified Opportunity" }, targeting: { baseAdSetId: "120250304395470484", countries: ["us"], customAudiences: [{ id: "999", name: "Invented" }] } },
      ads: [
        { name: "A", format: "single_image", message: "m", headline: "h", link: "https://x.com", image: 1, fromProposal: true, leadFormId: "42" },
        { name: "B", format: "single_image", message: "m", headline: "h", link: "https://x.com", image: 2 },
      ],
    },
  }
  const parsed = platformPlan.parse(normalizePlatformPlan("meta", raw, { proposal, meta: META }))
  if (parsed.platform !== "meta") throw new Error("platform")
  it("only uses ids the account already uses, and never an instant form or audience id from Claude", () => {
    expect(parsed.draft.pageId).toBe("699339163533807")
    expect(parsed.draft.adSet.pixel).toEqual({ pixelId: "300641693796955", event: "Sales Qualified Opportunity" })
    expect(parsed.draft.adSet.targeting.baseAdSetId).toBe("120250304395470484")
    expect(parsed.draft.adSet.targeting.baseAdSetName).toBe("MSP | Lookalike 1%")
    expect(parsed.draft.adSet.targeting.countries).toEqual(["US"])
    expect(parsed.draft.adSet.targeting.customAudiences).toEqual([])
    expect(parsed.draft.ads[0].leadFormId).toBeNull()
    expect(parsed.risks[0]).toMatch(/Facebook page/)
  })
  it("places proposal images and lists the ones that couldn't be used", () => {
    expect(parsed.draft.ads[0].imagePath).toBe("c1/a.png")
    expect(parsed.draft.ads[0].fromProposal).toBe(true)
    expect(parsed.draft.ads[1].imagePath).toBeNull()
    expect(parsed.proposal?.problems.join(" ")).toMatch(/B uses image 2/)
  })
  it("drops a pixel or ad set the account doesn't use", () => {
    const other = platformPlan.parse(normalizePlatformPlan("meta", { ...raw, draft: { ...raw.draft, adSet: { ...raw.draft.adSet, pixel: { pixelId: "1", event: "Lead" }, targeting: { baseAdSetId: "5", countries: ["GB"] } } } }, { proposal: null, meta: META }))
    if (other.platform !== "meta") throw new Error("platform")
    expect(other.draft.adSet.pixel).toBeNull()
    expect(other.draft.adSet.targeting.baseAdSetId).toBeNull()
    expect(other.proposal).toBeNull()
  })
})

describe("normalize: Reddit", () => {
  it("keeps only real post ids and cleans communities", () => {
    const raw = {
      ...why,
      draft: {
        campaign: { name: "Reddit | MSP", objective: "CONVERSIONS" },
        adGroup: { name: "MSP subs", dailyBudget: 150, startDate: "2026-11-01", targeting: { geolocations: ["us"], communities: ["r/msp", "sysadmin"] } },
        ads: [{ name: "Post 1", postId: "abc", clickUrl: "https://www.dnsfilter.com/msp", headline: "How MSPs cut DNS tickets" }, { name: "Post 2", postId: "t3_1abcd", clickUrl: "https://www.dnsfilter.com/msp", headline: "x" }],
      },
    }
    const parsed = platformPlan.parse(normalizePlatformPlan("reddit", raw, { proposal: null, meta: null }))
    if (parsed.platform !== "reddit") throw new Error("platform")
    expect(parsed.draft.adGroup.targeting.communities).toEqual(["msp", "sysadmin"])
    expect(parsed.draft.adGroup.targeting.geolocations).toEqual(["US"])
    expect(parsed.draft.ads.map((a) => a.postId)).toEqual([null, "t3_1abcd"])
  })
})
