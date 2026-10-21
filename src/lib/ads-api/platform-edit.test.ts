import { describe, expect, it, vi } from "vitest"
import { adsApiEnv } from "./gates"
import { fixTargeting, planEdit, runPlatformEdit, type EditCall, type PlatformBefore, type PlatformEditStore } from "./platform-edit"

const money = (n: number) => `$${n}`
const targeting = { geo_locations: { countries: ["US"] }, age_min: 25, age_max: 65, custom_audiences: [{ id: "9", name: "List" }], publisher_platforms: ["facebook", "instagram", "audience_network"], audience_network_positions: ["classic"], targeting_automation: { advantage_audience: 1 } }
const before: PlatformBefore = { name: "Camp", status: "ACTIVE", dailyBudget: null, adSets: [{ id: "100", name: "Set A", status: "ACTIVE", dailyBudget: 50, end: null, targeting }] }

describe("fixTargeting", () => {
  it("turns the Audience Network off and keeps everything else", () => {
    const { targeting: t } = fixTargeting(targeting, "audience_network_off")
    expect(t.publisher_platforms).toEqual(["facebook", "instagram"])
    expect(t).not.toHaveProperty("audience_network_positions")
    expect(t.custom_audiences).toEqual(targeting.custom_audiences)
    expect(t.geo_locations).toEqual(targeting.geo_locations)
    expect(t.targeting_automation).toEqual(targeting.targeting_automation)
  })
  it("names Facebook and Instagram when placements were automatic", () => {
    const { targeting: t } = fixTargeting({ geo_locations: { countries: ["US"] } }, "audience_network_off")
    expect(t.publisher_platforms).toEqual(["facebook", "instagram"])
  })
  it("turns Advantage+ audience off, and changes ages only", () => {
    expect(fixTargeting(targeting, "advantage_off").targeting.targeting_automation).toEqual({ advantage_audience: 0 })
    const ages = fixTargeting(targeting, "ages", { ageMin: 30 }).targeting
    expect([ages.age_min, ages.age_max]).toEqual([30, 65])
    expect(ages.publisher_platforms).toEqual(targeting.publisher_platforms)
  })
  it("refuses when the targeting wasn't read, or there's nothing to change", () => {
    expect(() => fixTargeting(null, "advantage_off")).toThrow(/Couldn't read/)
    expect(() => fixTargeting({ age_min: 30 }, "advantage_off")).toThrow(/Couldn't read/)
    expect(() => fixTargeting({ ...targeting, publisher_platforms: ["facebook"] }, "audience_network_off")).toThrow(/already off/)
    expect(() => fixTargeting({ ...targeting, targeting_automation: { advantage_audience: 0 } }, "advantage_off")).toThrow(/already off/)
    expect(() => fixTargeting(targeting, "ages", { ageMin: 70 })).toThrow()
  })
})

describe("planEdit", () => {
  it("only ever pauses, and never twice", () => {
    expect(planEdit("google_ads", "123", { kind: "pause" }, { name: "x", status: "ENABLED", dailyBudget: 10 }, money).call).toEqual({ via: "windsor", connector: "google_ads", action: "pause_campaign", params: { campaign_id: "123" } })
    expect(planEdit("microsoft_ads", "123", { kind: "pause" }, null, money).call).toMatchObject({ connector: "bing", action: "pause_campaign" })
    expect(planEdit("reddit", "abc", { kind: "pause" }, null, money).call).toEqual({ via: "reddit", path: "/campaigns/abc", body: { configured_status: "PAUSED" } })
    expect(() => planEdit("meta", "1", { kind: "pause" }, { name: "x", status: "PAUSED", dailyBudget: null }, money)).toThrow(/already paused/)
  })
  it("sends money in each platform's unit", () => {
    expect(planEdit("google_ads", "1", { kind: "budget", dailyBudget: 50 }, null, money).call).toMatchObject({ params: { amount_micros: 50_000_000, budget_type: "daily" } })
    expect(planEdit("meta", "1", { kind: "budget", dailyBudget: 60, adSetId: "100" }, before, money).call).toMatchObject({ action: "set_adset_budget", params: { adset_id: "100", amount: 6000 } })
    expect(planEdit("meta", "1", { kind: "budget", dailyBudget: 60 }, { ...before!, dailyBudget: 40 }, money).call).toMatchObject({ action: "set_campaign_budget", params: { amount: 6000 } })
    expect(() => planEdit("meta", "1", { kind: "budget", dailyBudget: 60 }, before, money)).toThrow(/pick the ad set/)
  })
  it("refuses changes a platform doesn't offer and ad sets outside the campaign", () => {
    expect(() => planEdit("reddit", "1", { kind: "budget", dailyBudget: 5 }, null, money)).toThrow()
    expect(() => planEdit("google_ads", "1", { kind: "pause_ad_set", adSetId: "100" }, before, money)).toThrow()
    expect(() => planEdit("meta", "1", { kind: "pause_ad_set", adSetId: "999" }, before, money)).toThrow(/isn't in this campaign/)
  })
  it("sends the whole targeting on a Meta fix", () => {
    const p = planEdit("meta", "1", { kind: "targeting", adSetId: "100", fix: "audience_network_off" }, before, money)
    expect(p.call).toMatchObject({ connector: "facebook", action: "update_adset" })
    expect(((p.call as Extract<EditCall, { via: "windsor" }>).params.targeting as Record<string, unknown>).custom_audiences).toEqual(targeting.custom_audiences)
    expect(p.operation).toBe("update_ad_set")
  })
  it("cleans and de-duplicates keywords", () => {
    const p = planEdit("google_ads", "1", { kind: "keywords", adGroupId: "5", keywords: [{ text: " DNS  Filter ", match: "EXACT" }, { text: "dns filter", match: "EXACT" }, { text: "dns filter", match: "PHRASE" }] }, null, money)
    expect((p.call as Extract<EditCall, { via: "windsor" }>).params.keywords).toEqual([
      { text: "dns filter", match_type: "EXACT" },
      { text: "dns filter", match_type: "PHRASE" },
    ])
  })
})

describe("runPlatformEdit", () => {
  const store = () => {
    const rows: Parameters<PlatformEditStore["log"]>[0][] = []
    const s: PlatformEditStore = { log: vi.fn(async (r) => (rows.push(r), { id: 1 })), finishLog: vi.fn(async () => {}) }
    return { rows, s }
  }
  const o = { by: "me", platform: "google_ads" as const, client: { id: "c", slug: "dnsfilter" }, accountId: "304-054-6900", campaignId: "1", change: { kind: "pause" as const }, before: { name: "x", status: "ENABLED", dailyBudget: 1 }, money }

  it("logs a dry run and sends nothing while the edit switches are off", async () => {
    const { rows, s } = store()
    const sender = { send: vi.fn() }
    const r = await runPlatformEdit({ store: s, sender, env: { ...adsApiEnv({ ADS_API_WRITES_ENABLED: "true", ADS_API_DRY_RUN: "false", ADS_API_PLATFORMS: "google_ads" }), editsEnabled: false } }, o)
    expect(r).toMatchObject({ ok: true, live: false })
    expect(sender.send).not.toHaveBeenCalled()
    expect(rows[0]).toMatchObject({ dry_run: true, operation: "pause_campaign", previous: o.before })
  })

  it("sends live with every switch on, and reports a refusal", async () => {
    const { s } = store()
    const env = { ...adsApiEnv({ ADS_API_WRITES_ENABLED: "true", ADS_API_DRY_RUN: "false", ADS_API_PLATFORMS: "google_ads" }), editsEnabled: true }
    expect(await runPlatformEdit({ store: s, sender: { send: async () => ({ isError: false, result: {} }) }, env }, o)).toMatchObject({ ok: true, live: true })
    expect(await runPlatformEdit({ store: s, sender: { send: async () => ({ isError: true, result: {} }) }, env }, o)).toMatchObject({ ok: false, live: true })
  })
})
