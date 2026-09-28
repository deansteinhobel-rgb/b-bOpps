import { describe, expect, it } from "vitest"
import { fatiguedAds, median, rankAds, type AdStat, type FatigueInput } from "./ads"

const ad = (id: string, spend: number, impressions: number, clicks: number, conversions = 0, leads = 0): AdStat => ({
  platform: "linkedin", external_account_id: "1", ad_id: id, ad_name: id, campaign_name: "c", spend, impressions, clicks, conversions, leads,
})

describe("rankAds", () => {
  it("only considers ads strictly above the account's median spend", () => {
    // spends 10, 20, 30, 40 → median 25 → eligible: c, d
    const [r] = rankAds([ad("a", 10, 1000, 100), ad("b", 20, 1000, 90), ad("c", 30, 1000, 10), ad("d", 40, 1000, 20)])
    expect(r.eligible).toBe(2)
    expect(r.basis).toBe("ctr")
    expect(r.best?.ad_id).toBe("d")
    expect(r.worst?.ad_id).toBe("c")
  })

  it("ranks by cost per result when 2+ eligible ads have 3+ results (conversions + leads)", () => {
    // spends 1, 2, 3, 300, 400, 500 → median 151.5 → eligible: x, y, z
    const [r] = rankAds([
      ad("s1", 1, 10, 1),
      ad("s2", 2, 10, 1),
      ad("s3", 3, 10, 1),
      ad("x", 300, 1000, 5, 2, 1), // 3 results → $100 each
      ad("y", 400, 1000, 50, 0, 8), // 8 results → $50 each
      ad("z", 500, 1000, 90, 1), // 1 result: not ranked on cost
    ])
    expect(r.basis).toBe("cost_per_result")
    expect(r.best?.ad_id).toBe("y")
    expect(r.worst?.ad_id).toBe("x")
  })

  it("falls back to CTR when only one eligible ad has 3+ results", () => {
    const [r] = rankAds([ad("a", 1, 10, 1), ad("b", 2, 10, 1), ad("x", 300, 1000, 5, 5), ad("y", 400, 1000, 50)])
    expect(r.basis).toBe("ctr")
    expect(r.best?.ad_id).toBe("y")
  })

  it("has no worst ad when only one ad is eligible", () => {
    const [r] = rankAds([ad("a", 10, 100, 1), ad("b", 20, 100, 2)])
    expect(r.best?.ad_id).toBe("b")
    expect(r.worst).toBeNull()
  })
})

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe("fatiguedAds", () => {
  const row = (id: string, first_seen: string, live = true): FatigueInput => ({
    platform: "meta", external_account_id: "1", ad_id: id, ad_name: id, campaign_name: "c", first_seen,
    data_from: "2026-06-30", data_through: "2026-09-27", live,
    recent_impressions: 1000, recent_clicks: 5, recent_spend: 100, early_impressions: 1000, early_clicks: 10,
  })
  it("lists live ads first seen 45+ days before data-through, flagging capped first-seen dates", () => {
    const out = fatiguedAds([row("old", "2026-06-30"), row("edge", "2026-08-13"), row("young", "2026-08-14"), row("paused", "2026-07-01", false)])
    expect(out.map((a) => a.ad_id)).toEqual(["old", "edge"])
    expect(out[0].firstSeenCapped).toBe(true)
    expect(out[1].ageDays).toBe(45)
    expect(out[1].ctrChangePct).toBe(-50)
  })
})
