import { describe, expect, it } from "vitest"
import { boldRuns, briefBlocks, docxFileName } from "./document"
import { MAX_NOTION_BLOCKS, notionChildren } from "./notion"
import { brief, totalAds, type CampaignBrief } from "./schema"

const sample: CampaignBrief = brief.parse({
  title: "MSP partners",
  summary: "Reach MSP owners on LinkedIn and Google with partner-program offers to get sign-ups.",
  objective: "100 MSP partner sign-ups in Q1.",
  audience: { who: "Owners and technical leads at MSPs with 10-200 staff.", segments: ["MSP owners", "MSP technical leads"], exclusions: ["Current partners"] },
  messaging: { proposition: "Add DNS security to your stack in a day.", pillars: ["Margin", "Speed"], offer: "Free NFR licenses", callToAction: "Become a partner" },
  channels: [
    { platform: "LinkedIn", role: "Reach MSP owners", adTypes: [{ format: "Single image", quantity: 6, specs: "1200x627" }, { format: "Document", quantity: 2 }] },
    { platform: "Google Ads", role: "Capture search demand", adTypes: [{ format: "Responsive search ad", quantity: 4 }] },
  ],
  abTests: [{ name: "Offer", hypothesis: "NFR beats margin", variantA: "Free NFR", variantB: "30% margin", metric: "Cost per sign-up" }],
  budget: { total: "$20,000" },
  kpis: [{ metric: "Cost per sign-up", target: "$200" }],
})

describe("campaign brief document", () => {
  it("counts every ad across channels", () => {
    expect(totalAds(sample)).toBe(12)
  })

  it("lays the brief out with a table of ad types per channel and the A/B tests", () => {
    const blocks = briefBlocks(sample, { clientName: "DNSFilter", createdOn: "2026-10-23", link: "https://app/x" })
    expect(blocks[0]).toEqual({ t: "h1", text: "MSP partners" })
    expect(blocks[1]).toEqual({ t: "p", text: "DNSFilter · 2026-10-23 · 12 ads across 2 channels" })
    const tables = blocks.filter((b) => b.t === "table")
    expect(tables[0]).toMatchObject({ head: ["Ad type", "Quantity", "Specs", "Purpose"], rows: [["Single image", "6", "1200x627", ""], ["Document", "2", "", ""]] })
    expect(blocks).toContainEqual({ t: "bullet", text: "**B:** 30% margin" })
    expect(blocks.at(-1)).toEqual({ t: "p", text: "Made in Lumaux: https://app/x" })
    // Empty sections are left out.
    expect(blocks.some((b) => b.t === "h2" && b.text === "Timeline")).toBe(false)
  })

  it("leads a review with what to change and what already works", () => {
    const reviewed = brief.parse({ ...sample, changes: [{ change: "Cut Meta.", why: "Lead quality was poor in past tests." }], keep: ["The Umbrella angle"] })
    const blocks = briefBlocks(reviewed, { clientName: "DNSFilter", createdOn: "2026-10-23" })
    expect(blocks[3]).toEqual({ t: "h2", text: "What we'd change" })
    expect(blocks[4]).toEqual({ t: "bullet", text: "**Cut Meta.** Lead quality was poor in past tests." })
    expect(blocks[5]).toEqual({ t: "h2", text: "What already works" })
    expect(briefBlocks(sample, { clientName: "DNSFilter", createdOn: "2026-10-23" })[3]).toEqual({ t: "h2", text: "Objective" })
  })

  it("splits **bold** lead-ins into runs", () => {
    expect(boldRuns("**Role:** reach owners")).toEqual([
      { text: "Role:", bold: true },
      { text: " reach owners", bold: false },
    ])
  })

  it("makes a safe Word file name", () => {
    expect(docxFileName("DNSFilter", "MSP / partners: Q1?")).toBe("DNSFilter campaign brief - MSP partners Q1.docx")
    expect(docxFileName("DNSFilter", "DNSFilter MSP Partner Acquisition")).toBe("DNSFilter campaign brief - MSP Partner Acquisition.docx")
  })
})

describe("campaign brief as Notion blocks", () => {
  it("drops the title, makes real tables, and stays within Notion's 100 blocks", () => {
    const blocks = briefBlocks(sample, { clientName: "DNSFilter", createdOn: "2026-10-23" })
    const children = notionChildren(blocks, "https://app/x") as { type: string; table?: { table_width: number; children: unknown[] } }[]
    expect(children[0].type).toBe("paragraph")
    const table = children.find((c) => c.type === "table")!
    expect(table.table!.table_width).toBe(4)
    expect(table.table!.children).toHaveLength(3)

    const many = Array.from({ length: 150 }, (_, i) => ({ t: "bullet" as const, text: `point ${i}` }))
    const cut = notionChildren(many, "https://app/x") as { paragraph?: { rich_text: { text: { content: string } }[] } }[]
    expect(cut).toHaveLength(MAX_NOTION_BLOCKS)
    expect(cut.at(-1)!.paragraph!.rich_text.map((r) => r.text.content).join("")).toContain("https://app/x")
  })
})
