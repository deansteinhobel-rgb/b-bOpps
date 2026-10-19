import { describe, expect, it } from "vitest"
import type { AdStat } from "./ads"
import { pickAds, reportSummary, type SummaryInput } from "./client-report"
import { derive } from "./performance"

const ad = (id: string, spend: number, impressions: number, clicks: number, conversions = 0, leads = 0): AdStat => ({
  platform: "linkedin", external_account_id: "1", ad_id: id, ad_name: id, campaign_name: "c", spend, impressions, clicks, conversions, leads,
})

describe("pickAds", () => {
  it("picks 2 for results and 2 for click-through rate, then the weakest from the rest", () => {
    const tiny = [5, 6, 7, 8, 9].map((n) => ad(`tiny${n}`, n, 100, 50, 3)) // under the median: never picked, however good
    const r = pickAds([
      ...tiny,
      ad("a", 300, 1000, 10, 6), // $50 a result
      ad("b", 400, 1000, 30, 4), // $100, 3% CTR
      ad("c", 500, 1000, 10, 3, 2), // $100, more results than b
      ad("d", 600, 1000, 50, 1), // 5% CTR
      ad("e", 700, 1000, 40), // 4% CTR, no results
    ])
    expect(r.byResults.map((a) => a.ad_id)).toEqual(["a", "c"])
    expect(r.byCtr.map((a) => a.ad_id)).toEqual(["d", "e"])
    expect(r.worstBasis).toBe("cost_per_result")
    expect(r.worst.map((a) => a.ad_id)).toEqual(["b"])
  })

  it("judges the weakest on click-through rate when too few ads have results", () => {
    const r = pickAds([ad("a", 10, 1000, 50), ad("b", 20, 1000, 50), ad("c", 30, 1000, 50), ad("d", 40, 1000, 20), ad("e", 50, 1000, 5), ad("f", 60, 1000, 30)])
    // median 35 → d, e, f eligible; none has results
    expect(r.byResults).toEqual([])
    expect(r.byCtr.map((a) => a.ad_id)).toEqual(["f", "d"])
    expect(r.worstBasis).toBe("ctr")
    expect(r.worst.map((a) => a.ad_id)).toEqual(["e"])
  })

  it("the overall report: top 3 for results, no CTR list, falling back to CTR when nothing brought results", () => {
    const tiny = [1, 2, 3, 4, 5, 6].map((n) => ad(`s${n}`, n, 10, 1))
    const withResults = pickAds([...tiny, ad("a", 300, 1000, 10, 3), ad("b", 400, 1000, 30, 4), ad("c", 500, 1000, 10, 2), ad("d", 600, 1000, 90), ad("e", 700, 1000, 10), ad("f", 800, 1000, 10, 1)], { results: 3, ctr: 0, weak: 3 })
    expect(withResults.byResults.map((x) => x.ad_id)).toEqual(["b", "a", "c"])
    expect(withResults.byCtr).toEqual([])
    const noResults = pickAds([ad("a", 10, 1000, 50), ad("b", 20, 1000, 50), ad("c", 30, 1000, 50), ad("d", 40, 1000, 20), ad("e", 50, 1000, 5), ad("f", 60, 1000, 30)], { results: 3, ctr: 0, weak: 3 })
    expect(noResults.byCtr.map((x) => x.ad_id)).toEqual(["f", "d", "e"])
  })

  it("shows the one ad there is and no weakest", () => {
    const r = pickAds([ad("a", 10, 1000, 5)])
    expect(r.byCtr.map((a) => a.ad_id)).toEqual(["a"])
    expect(r.worst).toEqual([])
  })
})

describe("reportSummary", () => {
  const base: SummaryInput = {
    scope: "LinkedIn",
    oneCampaign: false,
    platform: "linkedin",
    currency: "USD",
    compare: true,
    now: derive({ spend: 10000, impressions: 100000, clicks: 500, conversions: 20, leads: 10 }),
    prev: derive({ spend: 8000, impressions: 80000, clicks: 400, conversions: 10, leads: 10 }),
    target: 300,
    campaigns: [
      { platform: "linkedin", name: "Big", now: derive({ spend: 7000, impressions: 1, clicks: 1, conversions: 20, leads: 5 }), prev: derive({ spend: 8000, impressions: 1, clicks: 1, conversions: 10, leads: 10 }) },
      { platform: "linkedin", name: "New one", now: derive({ spend: 3000, impressions: 1, clicks: 1, conversions: 0, leads: 5 }), prev: derive({ spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0 }) },
    ],
    best: null,
    basis: "cost_per_result",
  }

  it("says what was spent, what it brought and how that compares", () => {
    const s = reportSummary(base)
    expect(s[0]).toBe("LinkedIn spent $10,000, up 25% on the period before.")
    expect(s[1]).toContain("30 results (20 conversions and 10 leads) at $333 each")
    expect(s[1]).toContain("17% cheaper than the period before ($400)")
    expect(s[1]).toContain("above the $300 target")
    expect(s.join(" ")).toContain("“Big” brought the most results: 25 (83% of the total)")
    expect(s.join(" ")).toContain("New in this period: “New one”.")
  })

  it("leaves out campaign lines for one campaign, and handles no results", () => {
    const s = reportSummary({ ...base, oneCampaign: true, now: derive({ spend: 500, impressions: 1000, clicks: 0, conversions: 0, leads: 0 }) })
    expect(s[1]).toBe("There were no conversions or leads this time, against 20 in the period before.")
    expect(s.join(" ")).not.toContain("Big")
  })
})
