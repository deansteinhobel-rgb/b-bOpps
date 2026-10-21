import { describe, expect, it } from "vitest"
import { conversionKey, fromConversionKey, pagesOf, promotedOf } from "./meta-ids"

// Shapes as Windsor returned them for Filevine and DNSFilter (2026-10-21).
const customConversion = JSON.stringify({
  pixel_id: "469401646563960",
  custom_event_type: "OTHER",
  pixel_rule: JSON.stringify({ and: [{ event: { eq: "FILEVINE_DEMO_REQUEST" } }, { or: [{ URL: { i_contains: "https://www.filevine.com/demo-request" } }] }] }),
  custom_conversion_id: "1069457875445605",
  smart_pse_enabled: false,
})

describe("Meta ids", () => {
  it("read a custom conversion with the event its rule names", () => {
    expect(promotedOf(customConversion)).toEqual({ pageId: null, conversion: { pixelId: "469401646563960", event: "FILEVINE_DEMO_REQUEST", customConversionId: "1069457875445605" } })
  })
  it("read custom events by name, standard events by type, and lead ads' page", () => {
    expect(promotedOf('{"pixel_id": "300641693796955", "custom_event_type": "OTHER", "custom_event_str": "Sales Qualified Opportunity"}').conversion).toEqual({ pixelId: "300641693796955", event: "Sales Qualified Opportunity" })
    expect(promotedOf('{"pixel_id": "469401646563960", "custom_event_type": "LEAD"}').conversion?.event).toBe("LEAD")
    expect(promotedOf('{"page_id": "699339163533807", "smart_pse_enabled": false}')).toEqual({ pageId: "699339163533807", conversion: null })
    expect(promotedOf("not json")).toEqual({ pageId: null, conversion: null })
  })
  it("rank pages by spend from the ads' actor ids", () => {
    expect(pagesOf([{ actor_id: "1", spend: 5 }, { actor_id: "2", spend: 50 }, { actor_id: "1", spend: 1 }, { actor_id: null, spend: 9 }])).toEqual(["2", "1"])
  })
  it("round-trip a conversion through its key", () => {
    const c = promotedOf(customConversion).conversion!
    expect(fromConversionKey(conversionKey(c))).toEqual(c)
    expect(fromConversionKey("x|y|")).toBeNull()
  })
})
