import { describe, expect, it } from "vitest"
import { briefComment, evaluate, notionStage, stageOf, successLine } from "./tests"
import { emptyNeeds, needsText } from "./brief-needs"

describe("stageOf", () => {
  const b = (master: string | null, paid: string | null = null) => ({ master, paid })
  it("moves a briefed test to ready on Status Paid Ready for Build or Master Status Client Approved", () => {
    expect(stageOf({ status: "briefed", outcome: null }, b("Production"))).toBe("in_production")
    expect(stageOf({ status: "briefed", outcome: null }, b("Client Approved"))).toBe("ready")
    expect(stageOf({ status: "briefed", outcome: null }, b("Production", "Ready for Build"))).toBe("ready")
    expect(stageOf({ status: "briefed", outcome: null }, b("Production", "Build in Progress"))).toBe("in_production")
    expect(stageOf({ status: "briefed", outcome: null }, null)).toBe("in_production")
  })
  it("moves it to live on Master Status Production Complete or Status Paid Gone Live, from briefed or ready", () => {
    expect(stageOf({ status: "briefed", outcome: null }, b("Production Complete"))).toBe("live")
    expect(stageOf({ status: "ready", outcome: null }, b("Client Approved", "Gone Live"))).toBe("live")
    expect(stageOf({ status: "ready", outcome: null }, b("Production"))).toBe("ready")
  })
  it("follows the app's own status after that, and any outcome means done", () => {
    expect(stageOf({ status: "planned", outcome: null }, null)).toBe("planned")
    expect(stageOf({ status: "live", outcome: null }, b("Production"))).toBe("live")
    expect(stageOf({ status: "review", outcome: null }, b("Production Complete"))).toBe("review")
    expect(stageOf({ status: "live", outcome: "carried" }, null)).toBe("done")
  })
})

describe("notionStage", () => {
  it("live wins over ready, and anything else is neither", () => {
    expect(notionStage({ master: "Client Approved", paid: "Gone Live" })).toBe("live")
    expect(notionStage({ master: "Client Approved", paid: null })).toBe("ready")
    expect(notionStage({ master: "New", paid: "Pending" })).toBeNull()
    expect(notionStage(null)).toBeNull()
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

describe("briefComment (Dean, 2026-10-15: easier to digest in Notion)", () => {
  const needs = needsText({ ...emptyNeeds("google_ads"), formats: { search: 1, display: 1 }, notes: "1 x Search ad group", designNotes: "8 x single images in 1200x1200 & 1200x628" })
  const text = briefComment({
    sprintNumber: 2,
    platformLabel: "Google Ads",
    title: "Launch Cisco Umbrella end-of-sale ads",
    hypothesis: "A Cisco Umbrella ad group sending clicks to /compare gets takeout leads at ≤$350.",
    notes: "Why (our data): Google is at 145% of pace.\nWhy (market): Cisco announced end-of-sale on Sep 1, 2026.",
    needs,
    success: "Cost per result at or below $350",
    deadline: "23 Oct 2026",
    appUrl: "https://bbmopsapp.vercel.app/clients/dnsfilter/sprint#test-1",
  })

  it("opens with a bold title, then platform, due date and a short link to the plan", () => {
    expect(text.split("\n").slice(0, 2)).toEqual([
      "**Sprint 2 test: Launch Cisco Umbrella end-of-sale ads**",
      "Google Ads · Due 23 Oct 2026 · [Full plan in Lumaux](https://bbmopsapp.vercel.app/clients/dnsfilter/sprint#test-1)",
    ])
  })

  it("puts the asks in bold sections with short template links, and the background last with bold labels", () => {
    expect(text).toContain("**What we need from copy**\n• Search Ad ([template](https://docs.google.com/")
    expect(text).toContain("**What we need from design**\n• Display Ad ([template](")
    expect(text).toContain("Notes: 8 x single images")
    expect(text.indexOf("**Success looks like**")).toBeLessThan(text.indexOf("**Background**"))
    expect(text).toContain("**Background**\n**Why (our data):** Google is at 145% of pace.\n**Why (market):** Cisco")
    expect(text).not.toMatch(/\(template: https/)
  })
})
