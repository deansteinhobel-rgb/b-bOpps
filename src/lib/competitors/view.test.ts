import { describe, expect, it } from "vitest"
import { compareMix, daysLive, isNew, labelMix } from "./view"

describe("daysLive", () => {
  it("counts from the library's start date, else from when we first saw the ad", () => {
    expect(daysLive({ started_on: "2026-09-20", first_seen_at: "2026-10-18T02:00:00Z" }, "2026-10-20")).toBe(30)
    expect(daysLive({ started_on: null, first_seen_at: "2026-10-18T02:00:00Z" }, "2026-10-20")).toBe(2)
  })
})

describe("isNew", () => {
  it("is new for 8 days after we first see it", () => {
    expect(isNew({ first_seen_at: "2026-10-12T01:00:00Z" }, "2026-10-20")).toBe(true)
    expect(isNew({ first_seen_at: "2026-10-11T01:00:00Z" }, "2026-10-20")).toBe(false)
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
