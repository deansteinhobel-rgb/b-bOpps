import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("./tokens", () => ({ accessToken: async () => "never-used", USER_AGENT: "test" }))
import { PlatformRefused } from "./build"
import { linkedInSender, restli, restliEncode } from "./linkedin"
import { redditSender } from "./reddit"

// Fake fetch that records every request. Never the real platforms.
function fakeFetch(reply: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit; body?: Record<string, unknown> }[] = []
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined })
    return reply(url, init)
  }) as unknown as typeof fetch
  return { f, calls }
}
const created = (id: string) => new Response(null, { status: 201, headers: { "x-restli-id": id } })
const token = async () => "t"
const readImage = async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" })

describe("LinkedIn sender", () => {
  it("forces statuses whatever the payload says", async () => {
    const { f, calls } = fakeFetch(() => created("9"))
    const s = linkedInSender({ token, readImage, fetch: f })
    await s.send("create_campaign_group", "508", { name: "g", status: "ACTIVE" })
    await s.send("create_campaign", "508", { name: "c", status: "ACTIVE" })
    await s.send("create_ad", "508", { intendedStatus: "ACTIVE" })
    await s.send("create_post", "508", { lifecycleState: "DRAFT", distribution: { feedDistribution: "MAIN_FEED" } })
    expect(calls.map((c) => [c.url.replace("https://api.linkedin.com/rest", ""), c.body?.status ?? c.body?.intendedStatus ?? c.body?.lifecycleState])).toEqual([
      ["/adAccounts/508/adCampaignGroups", "DRAFT"],
      ["/adAccounts/508/adCampaigns", "PAUSED"],
      ["/adAccounts/508/creatives", "PAUSED"],
      ["/posts", "PUBLISHED"],
    ])
    expect(calls[3].body?.distribution).toMatchObject({ feedDistribution: "NONE" })
    expect(calls.every((c) => c.init?.method === "POST" && (c.init.headers as Record<string, string>)["LinkedIn-Version"])).toBe(true)
  })

  it("has no other calls", async () => {
    const { f } = fakeFetch(() => created("9"))
    const s = linkedInSender({ token, readImage, fetch: f })
    await expect(s.send("create_ad_group", "508", {})).rejects.toBeInstanceOf(PlatformRefused)
    await expect(s.send("create_campaign", "../../x", {})).rejects.toBeInstanceOf(PlatformRefused)
    expect(f).not.toHaveBeenCalled()
  })

  it("tells a refusal from an unknown outcome", async () => {
    const refused = linkedInSender({ token, readImage, fetch: fakeFetch(() => Response.json({ message: "bad budget" }, { status: 422 })).f })
    await expect(refused.send("create_campaign", "508", {})).rejects.toBeInstanceOf(PlatformRefused)
    const down = linkedInSender({ token, readImage, fetch: fakeFetch(() => new Response("", { status: 503 })).f })
    const e = await down.send("create_campaign", "508", {}).catch((x) => x)
    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(PlatformRefused)
  })

  it("uploads images only to LinkedIn and waits until they're ready", async () => {
    const { f, calls } = fakeFetch((url) => {
      if (url.includes("initializeUpload")) return Response.json({ value: { uploadUrl: "https://www.linkedin.com/dms-uploads/abc", image: "urn:li:image:1" } })
      if (url.includes("dms-uploads")) return new Response(null, { status: 201 })
      return Response.json({ status: "AVAILABLE" })
    })
    const r = await linkedInSender({ token, readImage, fetch: f }).send("upload_image", "508", { owner: "urn:li:organization:5", imagePath: "x.png" })
    expect(r.id).toBe("urn:li:image:1")
    expect(calls[1].init?.method).toBe("PUT")

    const evil = fakeFetch(() => Response.json({ value: { uploadUrl: "https://evil.example/upload", image: "urn:li:image:1" } }))
    await expect(linkedInSender({ token, readImage, fetch: evil.f }).send("upload_image", "508", { owner: "urn:li:organization:5", imagePath: "x.png" })).rejects.toThrow(/upload host/)
    expect(evil.calls).toHaveLength(1)
  })

  it("encodes Rest.li queries", () => {
    expect(restli({ include: { and: [{ or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:1"] } }] } })).toBe(
      "(include:(and:List((or:(urn%3Ali%3AadTargetingFacet%3Alocations:List(urn%3Ali%3Ageo%3A1))))))",
    )
    // Brackets in values are Rest.li syntax unless encoded (LinkedIn 400 on "Finni Health (YC W23)").
    expect(restliEncode("Finni Health (YC W23)")).toBe("Finni%20Health%20%28YC%20W23%29")
    expect(restli(["urn:li:staffCountRange:(51,200)"])).toBe("List(urn%3Ali%3AstaffCountRange%3A%2851%2C200%29)")
  })
})

describe("Reddit sender", () => {
  it("wraps in data and forces PAUSED", async () => {
    const { f, calls } = fakeFetch(() => Response.json({ data: { id: "abc" } }, { status: 201 }))
    const r = await redditSender({ token, fetch: f }).send("create_campaign", "t2_3q8y68o7", { name: "c", configured_status: "ACTIVE" })
    expect(r.id).toBe("abc")
    expect(calls[0].url).toBe("https://ads-api.reddit.com/api/v3/ad_accounts/t2_3q8y68o7/campaigns")
    expect(calls[0].body).toEqual({ data: { name: "c", configured_status: "PAUSED" } })
  })
  it("has no other calls", async () => {
    const { f } = fakeFetch(() => Response.json({}))
    await expect(redditSender({ token, fetch: f }).send("create_post", "t2_x", {})).rejects.toBeInstanceOf(PlatformRefused)
    expect(f).not.toHaveBeenCalled()
  })
})
