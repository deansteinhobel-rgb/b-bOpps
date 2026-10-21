import { describe, expect, it } from "vitest"
import { pctText, surging, verdictHeadline, weeklyBuckets, weekTone } from "./weekly-read-rules"

describe("weekTone", () => {
  it("judges on target when there's one", () => {
    expect(weekTone({ results: 41, prevResults: 33, spend: 7670, cpr: 187, target: 200 })).toBe("good")
    expect(weekTone({ results: 20, prevResults: 33, spend: 4400, cpr: 220, target: 200 })).toBe("neutral")
    expect(weekTone({ results: 10, prevResults: 33, spend: 2500, cpr: 250, target: 200 })).toBe("bad")
  })
  it("calls no results after spending the target a bad week", () => {
    expect(weekTone({ results: 0, prevResults: 3, spend: 900, cpr: null, target: 500 })).toBe("bad")
    expect(weekTone({ results: 0, prevResults: 0, spend: 100, cpr: null, target: 500 })).toBe("neutral")
  })
  it("compares results with the week before when there's no target", () => {
    expect(weekTone({ results: 12, prevResults: 10, spend: 1000, cpr: 83, target: null })).toBe("good")
    expect(weekTone({ results: 7, prevResults: 10, spend: 1000, cpr: 142, target: null })).toBe("bad")
  })
})

describe("verdictHeadline", () => {
  it("says the results against target", () => {
    expect(verdictHeadline({ tone: "good", results: 41, spend: "$7,670", cpr: "$187", target: "$200", underTarget: true })).toBe("A good week: 41 results at $187 each, under the $200 target")
    expect(verdictHeadline({ tone: "bad", results: 0, spend: "$900", cpr: null, target: "$500", underTarget: null })).toBe("A hard week: $900 spent with no results")
    expect(verdictHeadline({ tone: "neutral", results: 1, spend: "$300", cpr: "$300", target: null, underTarget: null })).toBe("A steady week: 1 result at $300 each")
    expect(verdictHeadline({ tone: "good", results: 1144.203, spend: "$32,233", cpr: "$28", target: "$300", underTarget: true })).toBe("A good week: 1,144 results at $28 each, under the $300 target")
  })
})

describe("weeklyBuckets", () => {
  it("sums days into Monday-to-Sunday weeks ending on the given Sunday", () => {
    const daily = [
      { date: "2026-10-18", value: 2 }, // Sunday, last week
      { date: "2026-10-12", value: 3 }, // Monday, last week
      { date: "2026-10-11", value: 5 }, // Sunday, the week before
      { date: "2026-08-24", value: 9 }, // Monday, 8 weeks back
      { date: "2026-08-23", value: 100 }, // older: left out
    ]
    expect(weeklyBuckets(daily, "2026-10-18")).toEqual([9, 0, 0, 0, 0, 0, 5, 5])
  })
})

describe("surging", () => {
  it("keeps accounts clicking at 3x the average with enough volume", () => {
    const rows = [
      { name: "A", impressions: 1000, clicks: 5 },
      { name: "B", impressions: 200, clicks: 8 },
      { name: "C", impressions: 50, clicks: 5 }, // too few impressions
      { name: "D", impressions: 3000, clicks: 9 },
    ]
    expect(surging(rows).rows.map((r) => r.name)).toEqual(["B"])
  })
})

describe("pctText", () => {
  it("uses a real minus sign", () => {
    expect(pctText(-0.17)).toBe("−17%")
    expect(pctText(0.24)).toBe("+24%")
    expect(pctText(null)).toBeNull()
  })
})
