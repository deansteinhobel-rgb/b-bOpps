import { describe, expect, it } from "vitest"
import { computeInsights, type InsightInputs, type TermRow } from "./rules"

const term = (t: string, spend: number, results: number): TermRow => ({ campaignId: "pm", campaignName: "DG | Pmax | General Campaign", term: t, spend, impressions: spend * 2, clicks: spend / 10, results, isKeyword: false })
const run = (pmaxTerms: TermRow[]) =>
  computeInsights({
    clientName: "DNSFilter",
    currency: "USD",
    target: 300,
    dataThrough: {},
    campaigns: [],
    ads: [],
    terms: [],
    share: [],
    metaAdsets: [],
    metaLearningDays: [],
    metaAges: [],
    metaPlacements: [],
    linkedin: {},
    landing: [],
    pmaxTerms,
  } as InsightInputs).filter((i) => i.rule === "pmax_terms")

describe("pmax_terms", () => {
  it("flags one search carrying the campaign even when it converts under target", () => {
    const [i] = run([term("vpn", 11284, 99), term("dns filter", 5000, 60), term("malwarebytes", 519, 3), term("other", 2771, 10)])
    expect(i.items.map((x) => x.id)).toEqual(["vpn"])
    expect(i.severity).toBe("high")
    expect(i.why).toContain("check those are real buyers")
  })
  it("flags costly searches with no conversions, never brand terms or small ones", () => {
    const [i] = run([term("free vpn", 700, 0), term("dnsfilter login", 900, 0), term("tiny", 100, 0), ...[1, 2, 3, 4].map((n) => term(`good ${n}`, 5000, 40))])
    expect(i.items.map((x) => x.id)).toEqual(["free vpn"])
  })
  it("says nothing without a problem", () => {
    expect(run([term("a", 5000, 30), term("b", 5000, 30), term("c", 5000, 30), term("d", 5000, 30)])).toEqual([])
  })
})
