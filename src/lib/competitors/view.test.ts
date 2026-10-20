import { describe, expect, it } from "vitest"
import { compareMix, daysLive, firstReads, isNew, labelMix } from "./view"

describe("daysLive", () => {
  it("counts from the library's start date, else from when we first saw the ad", () => {
    expect(daysLive({ started_on: "2026-09-20", first_seen_at: "2026-10-18T02:00:00Z" }, "2026-10-20")).toBe(30)
    expect(daysLive({ started_on: null, first_seen_at: "2026-10-18T02:00:00Z" }, "2026-10-20")).toBe(2)
  })
})

describe("isNew", () => {
  const ad = (started_on: string | null, first_seen_at: string, competitor_id = "c1") => ({ competitor_id, source: "linkedin" as const, started_on, first_seen_at })
  it("goes by the library's start date when there is one", () => {
    const first = firstReads([ad(null, "2026-10-19T01:00:00Z")])
    expect(isNew(ad("2026-10-14", "2026-10-19T01:00:00Z"), "2026-10-20", first)).toBe(true)
    expect(isNew(ad("2026-09-01", "2026-10-19T01:00:00Z"), "2026-10-20", first)).toBe(false)
  })
  it("without one, ads from our first read of a competitor aren't new; later ones are, for 8 days", () => {
    const ads = [ad(null, "2026-10-04T01:00:00Z"), ad(null, "2026-10-18T01:00:00Z"), ad(null, "2026-10-18T01:00:00Z", "c2")]
    const first = firstReads(ads)
    expect(isNew(ads[1], "2026-10-20", first)).toBe(true)
    expect(isNew(ads[2], "2026-10-20", first)).toBe(false)
    expect(isNew(ads[1], "2026-10-27", first)).toBe(false)
  })
})

describe("labelMix", () => {
  it("ranks values by share, leaving Other out of the ranking but in the total", () => {
    expect(labelMix(["Download", "Download", "Book a demo", "Other", null])).toEqual([
      { value: "Download", count: 2, share: 0.5 },
      { value: "Book a demo", count: 1, share: 0.25 },
    ])
  })
})

describe("compareMix", () => {
  it("puts both sides' values together, biggest share first", () => {
    const rows = compareMix(["Download", "Download", "Book a demo"], ["Free trial / sign up", "Free trial / sign up", "Free trial / sign up", "Download"])
    expect(rows[0]).toEqual({ value: "Free trial / sign up", them: 0, us: 0.75 })
    expect(rows.find((r) => r.value === "Download")).toEqual({ value: "Download", them: 2 / 3, us: 0.25 })
  })
})
