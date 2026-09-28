import { describe, expect, it } from "vitest"
import { sprintByNumber, sprintDay, sprintOf } from "./periods"

describe("sprint periods", () => {
  it("Sprint 1 is Monday 28 Sep to Sunday 11 Oct 2026", () => {
    expect(sprintOf("2026-09-28")).toEqual({ number: 1, start: "2026-09-28", end: "2026-10-11" })
    expect(sprintOf("2026-10-11")).toEqual({ number: 1, start: "2026-09-28", end: "2026-10-11" })
  })

  it("fortnights roll on every other Monday, the same for every client", () => {
    expect(sprintOf("2026-10-12")).toEqual({ number: 2, start: "2026-10-12", end: "2026-10-25" })
    expect(sprintOf("2027-01-01")).toMatchObject({ number: 7, start: "2026-12-21" })
  })

  it("dates before Sprint 1 give earlier fortnights (used for trends)", () => {
    expect(sprintOf("2026-09-27")).toEqual({ number: 0, start: "2026-09-14", end: "2026-09-27" })
    expect(sprintByNumber(-1)).toEqual({ number: -1, start: "2026-08-31", end: "2026-09-13" })
  })

  it("counts the day within the sprint", () => {
    const s = sprintOf("2026-09-28")
    expect(sprintDay(s, "2026-09-28")).toBe(1)
    expect(sprintDay(s, "2026-10-11")).toBe(14)
    expect(sprintDay(s, "2026-12-01")).toBe(14)
  })
})
