import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("./tokens", () => ({ accessToken: async () => "never-used", USER_AGENT: "test" }))
import { linkedInAudienceCount } from "./linkedin"
import { explainLinkedIn, explainLinkedInRead } from "./linkedin-errors"

describe("LinkedIn errors in plain words", () => {
  it("says what happened, whether anything changed, and keeps LinkedIn's words", () => {
    expect(explainLinkedIn(403, "Not enough permissions")).toMatch(/isn't allowed to change this ad account\. Nothing was changed\..*\(LinkedIn 403: Not enough permissions\)$/)
    expect(explainLinkedIn(401)).toMatch(/pnpm ads:connect linkedin/)
    expect(explainLinkedIn(431)).toMatch(/too large/)
    expect(explainLinkedIn(429)).toMatch(/Wait a minute/)
    expect(explainLinkedIn(503)).toMatch(/may or may not have gone through/)
    // A failed read can't have changed anything, even when LinkedIn is down.
    expect(explainLinkedInRead(503)).toMatch(/Nothing was changed/)
  })

  it("asks for the audience size as a tunneled POST, so long ABM targeting fits", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Response.json({ elements: [{ total: 14000 }] })
    }) as unknown as typeof fetch
    const big = { include: { and: [{ or: { "urn:li:adTargetingFacet:employers": Array.from({ length: 800 }, (_, n) => `urn:li:organization:${n}`) } }] } }
    expect(await linkedInAudienceCount(big, { token: async () => "t", fetch: f })).toBe(14000)
    expect(calls[0].url).toBe("https://api.linkedin.com/rest/audienceCounts")
    expect(calls[0].init.method).toBe("POST")
    expect((calls[0].init.headers as Record<string, string>)["X-HTTP-Method-Override"]).toBe("GET")
    expect(String(calls[0].init.body)).toMatch(/^q=targetingCriteriaV2&targetingCriteria=\(include/)
  })

  it("explains a refused audience check", async () => {
    const f = (async () => Response.json({ message: "nope" }, { status: 431 })) as unknown as typeof fetch
    await expect(linkedInAudienceCount({ include: {} }, { token: async () => "t", fetch: f })).rejects.toThrow(/Couldn't check the audience size\. The campaign's targeting is too large/)
  })
})
