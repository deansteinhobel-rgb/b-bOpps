import { describe, expect, it } from "vitest"
import { londonToday, monthOf, weekOf } from "./periods"

describe("check periods", () => {
  it("weeks run Monday to Sunday", () => {
    expect(weekOf("2026-09-28")).toMatchObject({ start: "2026-09-28", end: "2026-10-04" }) // Monday
    expect(weekOf("2026-10-04")).toMatchObject({ start: "2026-09-28", end: "2026-10-04" }) // Sunday
    expect(weekOf("2026-10-01")).toMatchObject({ start: "2026-09-28", end: "2026-10-04" }) // across a month end
  })

  it("months are calendar months", () => {
    expect(monthOf("2026-09-28")).toMatchObject({ start: "2026-09-01", end: "2026-09-30" })
    expect(monthOf("2028-02-10")).toMatchObject({ start: "2028-02-01", end: "2028-02-29" })
  })

  it("uses the London date, not UTC", () => {
    // 23:30 UTC on Sunday 27 Sep is 00:30 Monday 28 Sep in London (BST)
    expect(londonToday(new Date("2026-09-27T23:30:00Z"))).toBe("2026-09-28")
    // In winter London is on UTC
    expect(londonToday(new Date("2026-12-06T23:30:00Z"))).toBe("2026-12-06")
  })
})
