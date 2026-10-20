import { describe, expect, it } from "vitest"
import { bestRank, longestRunning, runningSince, topAds, type KeywordAd } from "./keywords"
import { advertiserOf, keywordInput, linkedInRunDates, normalizeItems, normalizeKeywordItems, ANYONE } from "./sources"

const ad = (over: Partial<KeywordAd>): KeywordAd => ({
  id: over.external_id ?? "x",
  keyword_id: "k1",
  source: "meta",
  external_id: "1",
  advertiser: "Rival",
  headline: null,
  body: null,
  ranks: { US: 1 },
  ended_on: null,
  started_on: null,
  first_seen_at: "2026-10-18T01:00:00Z",
  last_seen_at: "2026-10-18T01:00:00Z",
  ...over,
})

describe("topAds", () => {
  it("keeps the latest read only, in the library's order (best rank across countries)", () => {
    const ads = [
      ad({ external_id: "a", ranks: { US: 5, GB: 2 } }),
      ad({ external_id: "b", ranks: { US: 1 } }),
      ad({ external_id: "old", ranks: { US: 0 }, last_seen_at: "2026-10-11T01:00:00Z" }),
    ]
    expect(topAds(ads).map((a) => a.external_id)).toEqual(["b", "a"])
    expect(bestRank(ads[0])).toBe(2)
  })
  it("stops at n", () => {
    expect(topAds(Array.from({ length: 40 }, (_, i) => ad({ external_id: String(i), ranks: { US: i } })), 30)).toHaveLength(30)
  })
})

describe("longestRunning", () => {
  it("Meta: oldest creative first, leaving out the client's own ads", () => {
    const top = [
      ad({ external_id: "1", headline: "One", started_on: "2026-09-01" }),
      ad({ external_id: "2", headline: "Two", started_on: "2025-01-01", advertiser: "DNSFilter, Inc." }),
      ad({ external_id: "3", headline: "Three", started_on: "2026-01-01" }),
      ad({ external_id: "4", headline: "Four", started_on: "2026-05-01" }),
      ad({ external_id: "5", headline: "Five", started_on: "2026-10-01" }),
    ]
    expect(longestRunning(top, ["DNSFilter"]).map((a) => a.external_id)).toEqual(["3", "4", "1"])
  })
  it("dates a creative by its earliest version: Meta re-dates an edited ad", () => {
    // DNSFilter, 2026-10-20: the same ad live since 18 Sept showed as started 19 Oct after an edit.
    const live = ad({ external_id: "new", headline: "One policy. Every client.", body: "Adding clients...", started_on: "2026-10-19" })
    const stopped = ad({ external_id: "old", headline: "One policy. Every client.", body: "Adding clients...", started_on: "2026-09-18", ended_on: "2026-10-19", ranks: {} })
    const other = ad({ external_id: "x", headline: "Something else", started_on: "2026-10-01" })
    expect(longestRunning([live, other], [], 3, [live, stopped, other]).map((a) => a.external_id)).toEqual(["new", "x"])
    expect(runningSince([live, stopped, other])(live).since).toBe("2026-09-18")
  })
  it("never picks two versions of the same creative", () => {
    const a = ad({ external_id: "a", headline: "Same", started_on: "2026-09-18" })
    const b = ad({ external_id: "b", headline: "Same", started_on: "2026-10-18" })
    expect(longestRunning([a, b], []).map((x) => x.external_id)).toEqual(["a"])
  })
  it("LinkedIn: the lowest ad id is the oldest", () => {
    const top = [ad({ source: "linkedin", headline: "A", external_id: "1558594183" }), ad({ source: "linkedin", headline: "B", external_id: "777006684" }), ad({ source: "linkedin", headline: "C", external_id: "1200000000" })]
    expect(longestRunning(top, [], 2).map((a) => a.external_id)).toEqual(["777006684", "1200000000"])
  })
  it("leaves stopped ads out of the top 30", () => {
    expect(topAds([ad({ external_id: "live" }), ad({ external_id: "gone", ended_on: "2026-10-10" })]).map((a) => a.external_id)).toEqual(["live"])
  })
})

describe("keyword sources", () => {
  it("ranks the first 30 live ads and keeps stopped ones unranked", () => {
    const items = [
      { ad_archive_id: "1", page_id: "9", page_name: "A", is_active: false, end_date: 1791529200, snapshot: {} },
      ...Array.from({ length: 35 }, (_, i) => ({ ad_archive_id: String(i + 10), page_id: "9", page_name: "A", is_active: true, snapshot: {} })),
    ]
    const ads = normalizeKeywordItems("meta", items, "2026-10-20")
    expect(ads.filter((a) => a.rank !== null)).toHaveLength(30)
    expect(ads[0]).toMatchObject({ external_id: "1", rank: null, active: false })
    expect(ads[1].rank).toBe(1)
  })
  it("reads LinkedIn run dates when the library shows them", () => {
    expect(linkedInRunDates("Ran from Oct 12, 2025 to Sep 27, 2026 Ad Impressions | > 1M")).toEqual({ started_on: "2025-10-12", ended_on: "2026-09-27" })
    expect(linkedInRunDates(null)).toEqual({ started_on: null, ended_on: null })
  })
  it("keeps every advertiser on a keyword search, and names them", () => {
    const items = [
      { adId: "1", advertiserName: "Someone", activeDatesText: "Ran from Sep 25, 2026 to Oct 2, 2026" },
      { adId: "2", advertiserName: null, payerName: "Payer Inc." },
    ]
    const ads = normalizeItems("linkedin", items, ANYONE, "2026-10-20")
    expect(ads.map((a) => a.started_on)).toEqual(["2026-09-25", null])
    expect(advertiserOf("linkedin", items[1])).toEqual({ name: "Payer Inc.", id: null })
    expect(advertiserOf("meta", { page_name: "Kaseya", page_id: "123" })).toEqual({ name: "Kaseya", id: "123" })
  })
  it("searches Meta by keyword in the country asked, stopped ads included (for earlier versions)", () => {
    const input = keywordInput("meta", "MSP security", "GB") as { urls: { url: string }[]; limitPerSource: number }
    expect(input.urls[0].url).toContain("active_status=all&ad_type=all&country=GB&q=MSP%20security&search_type=keyword_unordered")
    expect(input.limitPerSource).toBe(100)
    expect(keywordInput("linkedin", "DNS filtering", "US")).toEqual({ keyword: "DNS filtering", countries: ["US"], maxAds: 30 })
  })
})
