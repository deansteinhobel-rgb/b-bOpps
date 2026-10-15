import { describe, expect, it } from "vitest"
import { parseMetaTargeting } from "@/lib/windsor/settings-parse"
import { settingsInsights, type InsightInputs, type SettingRow } from "./rules"

const money = (v: number) => `$${Math.round(v)}`
const run = (settings: SettingRow[]) => settingsInsights({ settings } as InsightInputs, money)
const google = (id: string, name: string, settings: Record<string, unknown>): SettingRow => ({ platform: "google_ads", level: "campaign", entityId: id, entityName: name, campaignId: id, campaignName: name, settings })
const adset = (id: string, settings: Record<string, unknown>): SettingRow => ({ platform: "meta", level: "adset", entityId: id, entityName: `Ad set ${id}`, campaignId: "c1", campaignName: "Campaign", settings })

describe("parseMetaTargeting", () => {
  it("reads Advantage+ audience, lists vs lookalikes and location types from Windsor's JSON text", () => {
    const t = parseMetaTargeting(
      JSON.stringify({
        custom_audiences: [{ id: "1", name: "SMB Audience - Clay Enriched" }, { id: "2", name: "Lookalike (1%) - HubSpot customers" }],
        geo_locations: { countries: ["US"], location_types: ["home", "recent"] },
        targeting_automation: { advantage_audience: 1 },
      }),
    )
    expect(t).toEqual({ advantage_audience: true, matched_audiences: ["SMB Audience - Clay Enriched"], lookalikes: ["Lookalike (1%) - HubSpot customers"], location_types: ["home", "recent"] })
  })
  it("treats missing or broken targeting as unknown, never as a problem", () => {
    expect(parseMetaTargeting(null).advantage_audience).toBeNull()
    expect(parseMetaTargeting("{oops").matched_audiences).toEqual([])
  })
})

describe("settingsInsights", () => {
  it("flags presence-or-interest and search networks on search campaigns as urgent, AI Max as normal", () => {
    const out = run([
      google("1", "General Search", { geo_target_type: "PRESENCE_OR_INTEREST", channel_type: "SEARCH", search_partners: true, display_network: false, ai_max: true }),
      google("2", "Pmax", { geo_target_type: "PRESENCE", channel_type: "PERFORMANCE_MAX", search_partners: true, display_network: true }),
    ])
    const by = Object.fromEntries(out.map((i) => [i.rule, i]))
    expect(by.settings_geo.urgent).toBe(true)
    expect(by.settings_networks.items.map((x) => x.id)).toEqual(["1"]) // Performance Max uses every network on purpose
    expect(by.settings_ai_max.urgent).toBeUndefined()
  })
  it("flags Advantage+ audience only on list-based ad sets, and any Audience Network spend", () => {
    const out = run([
      adset("a", { advantage_audience: true, matched_audiences: ["Website visitors"], location_types: ["home"], audience_network_spend: 0 }),
      adset("b", { advantage_audience: true, matched_audiences: [], lookalikes: ["Lookalike (1%)"], location_types: ["home"], audience_network_spend: 12, spend: 100, days: 3 }),
    ])
    const by = Object.fromEntries(out.map((i) => [i.rule, i]))
    expect(by.settings_advantage.items.map((x) => x.id)).toEqual(["a"])
    expect(by.settings_audience_network.atStake).toBe(12)
    expect(by.settings_meta_location).toBeUndefined()
  })
  it("says nothing when the settings are fine", () => {
    expect(run([google("1", "Brand", { geo_target_type: "PRESENCE", channel_type: "SEARCH", search_partners: false, display_network: false, ai_max: false })])).toEqual([])
  })
})
