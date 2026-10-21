import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const { fieldsFor, mergeSplitRows, splitFieldsFor, toMetricRows } = await import("./client")

const meta = { client_id: "c", platform: "meta" as const, windsor_connector: "facebook", external_account_id: "1", conversion_fields: ["conversions_offsite_conversion_fb_pixel_custom_marketingqualifiedlead"], lead_fields: ["actions_lead"] }

describe("Meta action fields (Windsor zeroes spend when they come with metrics)", () => {
  it("keeps actions_* out of the numbers request and asks for them on their own", () => {
    expect(fieldsFor(meta)).not.toContain("actions_lead")
    expect(fieldsFor(meta)).toContain("conversions_offsite_conversion_fb_pixel_custom_marketingqualifiedlead")
    expect(splitFieldsFor(meta)).toEqual(["date", "campaign_id", "ad_id", "actions_lead"])
    expect(splitFieldsFor(meta, "campaign")).toEqual(["date", "campaign_id", "actions_lead"])
  })

  it("leaves other platforms in one request", () => {
    const li = { ...meta, platform: "linkedin" as const, windsor_connector: "linkedin", conversion_fields: ["externalwebsiteconversions"], lead_fields: ["oneclickleads"] }
    expect(fieldsFor(li)).toContain("oneclickleads")
    expect(splitFieldsFor(li)).toEqual([])
  })

  it("merges leads by date, campaign and ad without double counting", () => {
    const rows = toMetricRows(meta, [
      { date: "2026-10-07", campaign_id: "k", ad_id: "a", spend: 210.4, impressions: 900, clicks: 9, conversions_offsite_conversion_fb_pixel_custom_marketingqualifiedlead: 2 },
      { date: "2026-10-07", campaign_id: "k", ad_id: "b", spend: 44.7, impressions: 300, clicks: 3 },
    ])
    const extra = toMetricRows(meta, [
      { date: "2026-10-07", campaign_id: "k", ad_id: "a", actions_lead: 1 },
      { date: "2026-10-07", campaign_id: "k", ad_id: "b", actions_lead: 0 },
      { date: "2026-10-08", campaign_id: "k", ad_id: "b", actions_lead: 1 },
    ])
    const out = mergeSplitRows(rows, extra)
    expect(out).toHaveLength(3)
    const a = out.find((r) => r.ad_id === "a")!
    expect([a.spend, a.conversions, a.leads]).toEqual([210.4, 2, 1])
    const late = out.find((r) => r.date === "2026-10-08")!
    expect([late.spend, late.impressions, late.leads]).toEqual([0, 0, 1])
  })
})
