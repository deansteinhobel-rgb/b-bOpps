import { describe, expect, it } from "vitest"
import { canOfferPause, platformLink } from "./platform-links"

describe("platform links", () => {
  it("opens the campaign in each platform", () => {
    expect(platformLink("linkedin", "506013746", "214793814")).toBe("https://www.linkedin.com/campaignmanager/accounts/506013746/campaigns/214793814/details")
    expect(platformLink("google_ads", "252-844-2674", "123")).toBe("https://ads.google.com/aw/adgroups?campaignId=123&__e=2528442674")
    expect(platformLink("meta", "act_41375870", "99")).toBe("https://adsmanager.facebook.com/adsmanager/manage/adsets?act=41375870&selected_campaign_ids=99")
    expect(platformLink("reddit", "t2_3q8y68o7", "x")).toBe("https://ads.reddit.com/")
  })

  it("falls back to the account, and refuses odd ids", () => {
    expect(platformLink("linkedin", "506013746", null)).toBe("https://www.linkedin.com/campaignmanager/accounts/506013746/campaigns")
    expect(platformLink("linkedin", "abc", "1")).toBeNull()
    expect(platformLink("google_ads", "12", "1")).toBeNull()
    expect(platformLink("linkedin", null, "1")).toBeNull()
    expect(platformLink("linkedin", "506013746", "1/../x")).toBe("https://www.linkedin.com/campaignmanager/accounts/506013746/campaigns")
  })

  it("offers a pause only on running LinkedIn campaigns with a cost problem", () => {
    expect(canOfferPause("high_cpl", "linkedin", "1", "ACTIVE")).toBe(true)
    expect(canOfferPause("no_results", "linkedin", "1", null)).toBe(true)
    expect(canOfferPause("high_cpl", "linkedin", "1", "PAUSED")).toBe(false)
    expect(canOfferPause("high_cpl", "google_ads", "1", "ENABLED")).toBe(true)
    expect(canOfferPause("high_cpl", "google_ads", "1", "REMOVED")).toBe(false)
    expect(canOfferPause("high_cpl", "ga4", "1", null)).toBe(false)
    expect(canOfferPause("ctr_up", "linkedin", "1", "ACTIVE")).toBe(false)
  })
})
