import { describe, expect, it } from "vitest"
import { describeChange, describeNotionWrite, describePlatformWrite, fieldLabel, valueText } from "./activity"

describe("activity wording", () => {
  it("names fields and values in plain words", () => {
    expect(fieldLabel("monthly_kpi_target")).toBe("monthly KPI target")
    expect(fieldLabel("owner_profile_id")).toBe("owner")
    expect(valueText(null)).toBe("empty")
    expect(valueText(true)).toBe("yes")
    expect(valueText("0c9d3b1e-1111-4a4a-8b8b-123456789abc")).toBe("set")
    expect(valueText("2026-10-21T09:00:00+00:00")).toBe("2026-10-21")
    expect(valueText("planned")).toBe("“planned”")
  })

  it("describes inserts, edits and soft removals", () => {
    expect(describeChange({ table_name: "sprint_tests", op: "insert", label: "Reddit lead ads", changes: { title: "Reddit lead ads", platform: "reddit", client_id: "x" } })).toEqual({
      title: "Added a sprint test “Reddit lead ads”",
      details: ["platform: “reddit”"],
    })
    expect(describeChange({ table_name: "sprint_tests", op: "update", label: "X", changes: { status: { from: "planned", to: "briefed" } } })).toEqual({
      title: "Changed the sprint test “X”",
      details: ["status: “planned” → “briefed”"],
    })
    expect(describeChange({ table_name: "client_competitors", op: "update", label: "Cloudflare", changes: { removed_at: { from: null, to: "2026-10-21T10:00:00Z" } } }).title).toBe("Removed the competitor “Cloudflare”")
    expect(describeChange({ table_name: "sprint_tests", op: "update", label: null, changes: { archived_at: { from: null, to: "2026-10-21T10:00:00Z" } } }).title).toBe("Archived the sprint test")
  })

  it("reads Windsor's and Notion's logged payloads", () => {
    const neg = describePlatformWrite({ operation: "push_negative_keywords", campaign_id: null, ad_id: null, payload: { action: "push_negative_keywords", params: { keywords: [{ text: "ssl" }, { text: "ssh" }] } } })
    expect(neg).toEqual({ title: "Added negative keywords", details: ["2 terms: ssl, ssh"] })
    const brief = describeNotionWrite({ operation: "create_test_brief", payload: { properties: { Project: { title: [{ text: { content: "Lumaux | Paid Media | K-12" } }] } } } })
    expect(brief).toEqual({ title: "Briefed a test in Notion", details: ["“Lumaux | Paid Media | K-12”"] })
  })
})
