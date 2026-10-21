import { describe, expect, it, vi } from "vitest"
import { PlatformRefused } from "./build"
import { forcePaused, microsoftSender } from "./microsoft"
import { createdId, windsorSender, withImageLink, type WindsorRun } from "./windsor-sender"
import { guardParams } from "@/lib/windsor/write-guard"

// Fakes only: never Windsor or Microsoft.
const IMAGE = "11111111-2222-3333-4444-555555555555/a.png"
const signedUrl = async (p: string) => `https://storage.example/${p}?token=x`
const ok = (body: unknown) => ({ isError: false, result: { content: [{ type: "text", text: JSON.stringify(body) }] } })

function fakeRun(reply: (connector: string, action: string, params: Record<string, unknown>) => { isError: boolean; result: unknown }) {
  const calls: { connector: string; action: string; account: string; params: Record<string, unknown> }[] = []
  const run: WindsorRun = vi.fn(async (connector, action, account, params) => {
    calls.push({ connector, action, account, params })
    return reply(connector, action, params)
  })
  return { run, calls }
}

describe("windsorSender", () => {
  it("maps Google build steps to Windsor actions and reads the new ids", async () => {
    const { run, calls } = fakeRun((_, action) => (action === "create_campaign" ? ok({ campaign_id: "123456789" }) : action === "create_ad_group" ? ok({ resource_name: "customers/1/adGroups/987654321" }) : ok({ ok: true })))
    const s = windsorSender("google_ads", { run, signedUrl })
    expect(await s.send("create_campaign", "304-054-6900", { name: "x" })).toMatchObject({ id: "123456789" })
    expect(await s.send("set_locations", "304-054-6900", { campaign_id: "1" })).toMatchObject({ id: "done" })
    expect(await s.send("add_keywords", "304-054-6900", { ad_group_id: "1" })).toMatchObject({ id: "done" })
    expect(await s.send("create_ad_group", "304-054-6900", { campaign_id: "1" })).toMatchObject({ id: "987654321" })
    expect(calls.map((c) => [c.connector, c.action])).toEqual([
      ["google_ads", "create_campaign"],
      ["google_ads", "set_campaign_geo_targeting"],
      ["google_ads", "push_keywords"],
      ["google_ads", "create_ad_group"],
    ])
  })

  it("refuses operations a platform doesn't have, and Windsor's errors as refusals", async () => {
    const { run } = fakeRun(() => ({ isError: true, result: { content: [{ type: "text", text: "Budget too low" }] } }))
    const g = windsorSender("google_ads", { run, signedUrl })
    await expect(g.send("create_ad_set", "1", {})).rejects.toBeInstanceOf(PlatformRefused)
    await expect(g.send("create_campaign", "1", {})).rejects.toThrow(/Budget too low/)
    await expect(g.send("create_campaign", "1", {})).rejects.toBeInstanceOf(PlatformRefused)
  })

  it("an answer with no id is an unknown outcome, not a refusal", async () => {
    const { run } = fakeRun(() => ok({ message: "created" }))
    const err = await windsorSender("meta", { run, signedUrl }).send("create_campaign", "216540795750851", { name: "x" }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PlatformRefused)
  })

  it("swaps Meta's image_path for a signed link, in the creative when there is one", async () => {
    const { run, calls } = fakeRun(() => ok({ ad_id: "555555" }))
    const s = windsorSender("meta", { run, signedUrl })
    await s.send("create_ad", "216540795750851", { adset_id: "1", image_path: IMAGE })
    await s.send("create_ad", "216540795750851", { adset_id: "1", image_path: IMAGE, creative: { object_story_spec: { page_id: "2", link_data: { link: "https://x.com" } } } })
    expect(calls[0].params).toEqual({ adset_id: "1", image_url: `https://storage.example/${IMAGE}?token=x` })
    expect(calls[1].params).not.toHaveProperty("image_path")
    expect(calls[1].params).not.toHaveProperty("image_url")
    expect((calls[1].params.creative as { object_story_spec: { link_data: { picture: string } } }).object_story_spec.link_data.picture).toContain(IMAGE)
    expect(calls[0].action).toBe("create_ad")
  })

  it("refuses an image that isn't a campaign asset", async () => {
    await expect(withImageLink({ image_path: "../secret.png" }, signedUrl)).rejects.toBeInstanceOf(PlatformRefused)
  })
})

describe("createdId", () => {
  it("prefers the operation's own id key and reads structured content and plain text", () => {
    expect(createdId({ structuredContent: { ad_group_id: "1111111", ad_id: "2222222" } }, "create_ad")).toBe("2222222")
    expect(createdId({ structuredContent: { result: { campaign: { id: 33333333 } } } }, "create_campaign")).toBe("33333333")
    expect(createdId({ content: [{ type: "text", text: "Created campaign with ID 44444444." }] })).toBe("44444444")
    expect(createdId({ content: [{ type: "text", text: "done" }] })).toBeNull()
  })
})

describe("guardParams", () => {
  it("only allows the listed actions, never enable, remove or delete", () => {
    expect(() => guardParams("google_ads", "enable_campaign", {})).toThrow()
    expect(() => guardParams("google_ads", "remove_keywords", {})).toThrow()
    expect(() => guardParams("facebook", "boost_post", {})).toThrow()
    expect(() => guardParams("bing", "enable_campaign", {})).toThrow()
    expect(() => guardParams("tiktok", "pause_campaign", {})).toThrow()
  })
  it("forces creates to paused", () => {
    expect(guardParams("google_ads", "create_campaign", { name: "x", status: "enabled" }).status).toBe("paused")
    expect(guardParams("facebook", "create_ad", { status: "active" }).status).toBe("paused")
    expect(guardParams("facebook", "create_adset", {}).status).toBe("paused")
  })
  it("lets Meta updates touch only their few fields, and targeting only whole", () => {
    expect(() => guardParams("facebook", "update_campaign", { campaign_id: "1", spend_cap: 5 })).toThrow()
    expect(() => guardParams("facebook", "update_adset", { adset_id: "1", bid_amount: 5 })).toThrow()
    expect(() => guardParams("facebook", "update_adset", { adset_id: "1", targeting: { age_min: 30 } })).toThrow()
    expect(guardParams("facebook", "update_adset", { adset_id: "1", targeting: { geo_locations: { countries: ["US"] } } })).toBeTruthy()
  })
})

describe("microsoftSender (unverified)", () => {
  const deps = (reply: () => Response) => {
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) })
      return reply()
    }) as unknown as typeof fetch
    return { calls, sender: microsoftSender({ token: async () => "t", developerToken: "dev", customerId: "42", fetch: f }) }
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

  it("adds the account, forces Paused and reads the new id", async () => {
    const { calls, sender } = deps(() => json({ CampaignIds: [9001], PartialErrors: [] }))
    const r = await sender.send("create_campaign", "777", { Campaigns: [{ Name: "x", Status: "Active" }] })
    expect(r.id).toBe("9001")
    expect(calls[0].url).toMatch(/\/CampaignManagement\/v13\/Campaigns$/)
    expect(calls[0].body.AccountId).toBe(777)
    expect((calls[0].body.Campaigns as { Status: string }[])[0].Status).toBe("Paused")
    expect(calls[0].headers).toMatchObject({ DeveloperToken: "dev", CustomerId: "42", CustomerAccountId: "777" })
  })

  it("treats PartialErrors and 4xx as refusals", async () => {
    await expect(deps(() => json({ AdGroupIds: [null], PartialErrors: [{ Message: "Bad bid" }] })).sender.send("create_ad_group", "777", { AdGroups: [{}] })).rejects.toBeInstanceOf(PlatformRefused)
    await expect(deps(() => json({ Message: "nope" }, 400)).sender.send("create_ad", "777", { Ads: [{}] })).rejects.toBeInstanceOf(PlatformRefused)
    await expect(deps(() => json({}, 500)).sender.send("create_ad", "777", { Ads: [{}] })).rejects.not.toBeInstanceOf(PlatformRefused)
  })

  it("only knows its five calls", async () => {
    await expect(deps(() => json({})).sender.send("create_ad_set", "777", {})).rejects.toBeInstanceOf(PlatformRefused)
    expect(forcePaused("create_ad", { Ads: [{ Status: "Active" }] })).toEqual({ Ads: [{ Status: "Paused" }] })
  })
})
