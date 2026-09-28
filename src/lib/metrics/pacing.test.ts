import { describe, expect, it } from "vitest"
import { calculatePacing, daysInMonth } from "./pacing"

const base = { dataThrough: "2026-09-27", lastTwoDaysSpend: [100, 100] as [number, number] }

describe("calculatePacing", () => {
  it("uses days up to the data-through date, not today", () => {
    const r = calculatePacing({ ...base, spendMtd: 9000, budget: 10000 })
    expect(r.daysElapsed).toBe(27)
    expect(r.daysInMonth).toBe(30)
    expect(r.expected).toBeCloseTo(9000)
    expect(r.ratio).toBeCloseTo(1)
    expect(r.status).toBe("green")
  })

  // Real September 2026 numbers from Windsor (data through 27 Sep), checked by hand with Dean.
  it.each([
    ["DNSFilter LinkedIn", 24235.18, 20000, "red"],
    ["DNSFilter Google", 80015, 70000, "red"],
    ["DNSFilter Meta", 5518, 15000, "amber"],
    ["Camber LinkedIn", 8610.77, 10000, "green"],
    ["Camber Google", 1855, 5000, "amber"],
    ["Camber Meta", 6002, 5000, "red"],
  ] as const)("%s: spend %d on budget %d is %s", (_name, spendMtd, budget, status) => {
    expect(calculatePacing({ ...base, spendMtd, budget }).status).toBe(status)
  })

  it("is green up to exactly ±10% and amber just beyond", () => {
    expect(calculatePacing({ ...base, spendMtd: 9900, budget: 10000 }).status).toBe("green") // +10%
    expect(calculatePacing({ ...base, spendMtd: 8100, budget: 10000 }).status).toBe("green") // −10%
    expect(calculatePacing({ ...base, spendMtd: 9910, budget: 10000 }).status).toBe("amber")
    expect(calculatePacing({ ...base, spendMtd: 8090, budget: 10000 }).status).toBe("amber")
  })

  it("is amber at exactly +20% and red just above", () => {
    expect(calculatePacing({ ...base, spendMtd: 10800, budget: 10000 }).status).toBe("amber")
    expect(calculatePacing({ ...base, spendMtd: 10810, budget: 10000 }).status).toBe("red")
  })

  it("never turns underspend red on its own", () => {
    const r = calculatePacing({ ...base, spendMtd: 100, budget: 10000 })
    expect(r.status).toBe("amber")
    expect(r.variancePct).toBeCloseTo(-98.9, 1)
  })

  it("is red when the last two days have zero spend and a budget is set", () => {
    const r = calculatePacing({ ...base, spendMtd: 9000, budget: 10000, lastTwoDaysSpend: [0, 0] })
    expect(r.status).toBe("red")
    expect(r.reasons).toContain("No spend on the last 2 available days")
  })

  it("is not red when only one of the last two days has zero spend", () => {
    expect(calculatePacing({ ...base, spendMtd: 9000, budget: 10000, lastTwoDaysSpend: [0, 50] }).status).toBe("green")
  })

  it("reports no_budget (not red) when the budget is missing or zero, even with zero spend", () => {
    expect(calculatePacing({ ...base, spendMtd: 0, budget: null, lastTwoDaysSpend: [0, 0] }).status).toBe("no_budget")
    expect(calculatePacing({ ...base, spendMtd: 500, budget: 0 }).status).toBe("no_budget")
  })

  it("handles the first day of a month and 31-day months", () => {
    const r = calculatePacing({ spendMtd: 100, budget: 3100, dataThrough: "2026-10-01", lastTwoDaysSpend: [100, 90] })
    expect(r.daysElapsed).toBe(1)
    expect(r.daysInMonth).toBe(31)
    expect(r.expected).toBeCloseTo(100)
    expect(r.status).toBe("green")
  })

  it("rejects a malformed date", () => {
    expect(() => calculatePacing({ ...base, spendMtd: 1, budget: 1, dataThrough: "27/09/2026" })).toThrow()
  })
})

describe("daysInMonth", () => {
  it("knows February in leap and normal years", () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
  })
})
