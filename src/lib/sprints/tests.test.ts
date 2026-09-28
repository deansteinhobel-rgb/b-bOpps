import { describe, expect, it } from "vitest"
import { evaluate, stageOf, successLine } from "./tests"

describe("stageOf", () => {
  it("moves a briefed test to ready when Notion says Client Approved or Production Complete", () => {
    expect(stageOf({ status: "briefed", outcome: null }, "Production")).toBe("in_production")
    expect(stageOf({ status: "briefed", outcome: null }, "Client Approved")).toBe("ready")
    expect(stageOf({ status: "briefed", outcome: null }, "Production Complete")).toBe("ready")
    expect(stageOf({ status: "briefed", outcome: null }, null)).toBe("in_production")
  })
  it("follows the app's own status after that, and any outcome means done", () => {
    expect(stageOf({ status: "planned", outcome: null }, null)).toBe("planned")
    expect(stageOf({ status: "live", outcome: null }, "Production Complete")).toBe("live")
    expect(stageOf({ status: "review", outcome: null }, null)).toBe("review")
    expect(stageOf({ status: "live", outcome: "carried" }, null)).toBe("done")
  })
})

describe("evaluate", () => {
  const t = { spend: 1000, impressions: 20000, clicks: 200, conversions: 3, leads: 1, days: 7, data_through: "2026-10-05" }
  it("works out the metric and compares it with the target in the right direction", () => {
    expect(evaluate("cost_per_result", 300, t)).toEqual({ value: 250, meets: true, results: 4 })
    expect(evaluate("cost_per_result", 200, t).meets).toBe(false)
    expect(evaluate("ctr", 1.2, t)).toMatchObject({ value: 1, meets: false })
    expect(evaluate("cpc", 5, t)).toMatchObject({ value: 5, meets: true })
    expect(evaluate("results", 4, t)).toMatchObject({ value: 4, meets: true })
  })
  it("has no verdict without a result, target or known metric", () => {
    expect(evaluate("cost_per_result", 300, { ...t, conversions: 0, leads: 0 }).meets).toBeNull()
    expect(evaluate("cost_per_result", null, t).meets).toBeNull()
    expect(evaluate(null, 300, t).meets).toBeNull()
  })
})

describe("successLine", () => {
  const money = (v: number) => `$${v}`
  it("reads naturally", () => {
    expect(successLine("cost_per_result", 250, null, money)).toBe("Cost per result at or below $250")
    expect(successLine("ctr", 0.8, "and at least 10 leads", money)).toBe("CTR at or above 0.8%. and at least 10 leads")
    expect(successLine(null, null, null, money)).toBe("Not set")
  })
})
