import { describe, expect, it } from "vitest"
import { cut, normalizeItems, runIsHealthy, SOURCES, youTubeThumb, type Competitor } from "./sources"

// Hand-made items in the shape each actor returns (no real competitor data in the repo).
const rival: Competitor = { id: "c1", name: "Rival", meta_page_id: "111", linkedin_advertiser: "Rival", google_advertiser_ids: ["AR123456789012"] }
const today = "2026-10-20"

describe("meta", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    ad_archive_id: "900",
    page_id: "111",
    is_active: true,
    start_date: 1791529200,
    end_date: 1792479600,
    publisher_platform: ["FACEBOOK", "INSTAGRAM"],
    snapshot: {
      display_format: "DCO",
      title: null,
      body: { text: "Block threats at the DNS layer." },
      cta_text: "Learn more",
      link_url: "https://rival.example/demo",
      images: [],
      videos: [],
      cards: [{ title: "Card title", body: "Card body", original_image_url: "https://scontent.xx.fbcdn.net/a.jpg", link_url: "https://rival.example/card" }],
    },
    ...over,
  })

  it("reads copy, dates, placements and the first image", () => {
    const [ad] = normalizeItems("meta", [item()], rival, today)
    expect(ad).toMatchObject({
      external_id: "900",
      started_on: "2026-10-09",
      ended_on: null,
      active: true,
      format: "dco",
      headline: "Card title",
      body: "Block threats at the DNS layer.",
      landing_url: "https://rival.example/demo",
      placements: ["facebook", "instagram"],
      library_url: "https://www.facebook.com/ads/library/?id=900",
      media_url: "https://scontent.xx.fbcdn.net/a.jpg",
    })
  })

  it("drops error rows, other pages' ads and duplicates", () => {
    const ads = normalizeItems("meta", [{ error: "Ads not found" }, item({ page_id: "222" }), item(), item()], rival, today)
    expect(ads).toHaveLength(1)
  })

  it("keeps the end date only for stopped ads", () => {
    const [ad] = normalizeItems("meta", [item({ is_active: false })], rival, today)
    expect(ad.active).toBe(false)
    expect(ad.ended_on).toBe("2026-10-20")
  })

  it("asks for nothing without a page id", () => {
    expect(SOURCES.meta.input({ ...rival, meta_page_id: null }, "US")).toBeNull()
  })
})

describe("google", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    creativeId: "CR1",
    advertiserId: "AR123456789012",
    format: "video",
    adUrl: "https://adstransparency.google.com/advertiser/AR123456789012/creative/CR1",
    firstShown: "2026-10-01",
    lastShown: "2026-10-19",
    headline: null,
    imageUrls: [],
    videoUrls: ["https://youtube.com/embed/TJoimuqvf9g"],
    variants: [{ headline: "Stop threats", text: "Stop threats", displayUrl: "https://rival.example/lp", destinationUrl: "https://www.googleadservices.com/pagead/aclk?x" }],
    ...over,
  })

  it("reads a video ad with a YouTube thumbnail and the display URL as landing page", () => {
    const [ad] = normalizeItems("google", [item()], rival, today)
    expect(ad).toMatchObject({
      external_id: "CR1",
      started_on: "2026-10-01",
      active: true,
      headline: "Stop threats",
      body: null,
      landing_url: "https://rival.example/lp",
      media_url: "https://i.ytimg.com/vi/TJoimuqvf9g/hqdefault.jpg",
    })
  })

  it("counts an ad last shown over 3 days ago as stopped", () => {
    const [ad] = normalizeItems("google", [item({ lastShown: "2026-10-10" })], rival, today)
    expect(ad.active).toBe(false)
    expect(ad.ended_on).toBe("2026-10-10")
  })

  it("drops resellers' ads found under the same domain", () => {
    expect(normalizeItems("google", [item({ advertiserId: "AR999" })], rival, today)).toHaveLength(0)
  })
})

describe("linkedin", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    adId: "1558594183",
    adUrl: "https://www.linkedin.com/ad-library/detail/1558594183?trk=x",
    advertiserName: "Rival",
    creativeText: "Why is secure access so hard?",
    headline: "Switch to Zero Trust",
    callToAction: "Learn more",
    creativeType: "SPONSORED_STATUS_UPDATE",
    mediaUrls: ["https://media.licdn.com/dms/image/company-logo_100_100/x", "https://media.licdn.com/dms/image/image-shrink_1280/y"],
    ...over,
  })

  it("skips the company logo and strips tracking from the library link", () => {
    const [ad] = normalizeItems("linkedin", [item()], rival, today)
    expect(ad).toMatchObject({
      external_id: "1558594183",
      started_on: null,
      active: true,
      format: "sponsored_status_update",
      headline: "Switch to Zero Trust",
      library_url: "https://www.linkedin.com/ad-library/detail/1558594183",
      media_url: "https://media.licdn.com/dms/image/image-shrink_1280/y",
    })
  })

  it("keeps only the advertiser asked for", () => {
    expect(normalizeItems("linkedin", [item({ advertiserName: "Rival Partners" })], rival, today)).toHaveLength(0)
  })
})

describe("helpers", () => {
  it("only accepts YouTube video ids", () => {
    expect(youTubeThumb("https://www.youtube.com/watch?v=TJoimuqvf9g")).toBe("https://i.ytimg.com/vi/TJoimuqvf9g/hqdefault.jpg")
    expect(youTubeThumb("https://evil.example/embed/TJoimuqvf9g")).toBeNull()
  })

  it("never closes live ads on an empty run", () => {
    expect(runIsHealthy(0, 5)).toBe(false)
    expect(runIsHealthy(0, 0)).toBe(true)
    expect(runIsHealthy(3, 5)).toBe(true)
  })
})

describe("cut", () => {
  it("never ends on half an emoji, and drops NUL characters", () => {
    expect(cut("ab😀cd", 3)).toBe("ab")
    expect(cut("ab😀cd", 4)).toBe("ab😀")
    expect(cut("a\u0000b", 10)).toBe("ab")
  })
})
