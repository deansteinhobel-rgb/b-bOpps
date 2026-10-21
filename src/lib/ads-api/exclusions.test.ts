import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("./tokens", () => ({ accessToken: async () => "never-used", USER_AGENT: "test" }))
import { campaignPatch, describeChange, runEdit, type Before } from "./edit"
import { EXCLUDE_FACETS, exclusionFor, matchCompany, seniorityUrn, withExclusions } from "./exclusions"
import { linkedInEditSender } from "./linkedin"

const SEN = EXCLUDE_FACETS.seniorities
const EMP = EXCLUDE_FACETS.employers
const current = {
  include: { and: [{ or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:103644278"] } }, { or: { "urn:li:adTargetingFacet:titles": ["urn:li:title:1"] } }] },
  exclude: { or: { [EMP]: ["urn:li:organization:9"] } },
}
const entry = { urn: "urn:li:seniority:3", name: "Entry" }
const training = { urn: "urn:li:seniority:2", name: "Training" }

describe("LinkedIn exclusions", () => {
  it("adds to one exclude facet and keeps everything else", () => {
    const { targeting, added } = withExclusions(current, "seniorities", [entry, training, entry])
    expect(targeting.include).toBe(current.include)
    expect(targeting.exclude.or).toEqual({ [EMP]: ["urn:li:organization:9"], [SEN]: ["urn:li:seniority:3", "urn:li:seniority:2"] })
    expect(added.map((a) => a.name)).toEqual(["Entry", "Training"])
  })

  it("keeps companies already excluded and skips them", () => {
    const { targeting, already, added } = withExclusions(current, "employers", [{ urn: "urn:li:organization:9", name: "PwC" }, { urn: "urn:li:organization:7", name: "KPMG US" }])
    expect(targeting.exclude.or[EMP]).toEqual(["urn:li:organization:9", "urn:li:organization:7"])
    expect(already.map((a) => a.name)).toEqual(["PwC"])
    expect(added.map((a) => a.name)).toEqual(["KPMG US"])
  })

  it("refuses without the current targeting, when targeted on purpose, or with nothing new", () => {
    expect(() => withExclusions(null, "seniorities", [entry])).toThrow(/current targeting/)
    expect(() => withExclusions({ exclude: {} }, "seniorities", [entry])).toThrow(/current targeting/)
    const targetsEntry = { include: { and: [{ or: { [SEN]: ["urn:li:seniority:3"] } }] } }
    expect(() => withExclusions(targetsEntry, "seniorities", [entry])).toThrow(/on purpose/)
    expect(() => withExclusions(current, "employers", [{ urn: "urn:li:organization:9", name: "PwC" }])).toThrow(/Already excluded/)
  })

  it("maps rules, seniorities and company names", () => {
    expect(exclusionFor("li_junior")).toBe("seniorities")
    expect(exclusionFor("li_not_icp")).toBe("employers")
    expect(exclusionFor("meta_placements" as never)).toBeNull()
    expect(seniorityUrn("Entry")).toBe("urn:li:seniority:3")
    expect(seniorityUrn("Unpaid")).toBe("urn:li:seniority:1")
    const results = [{ name: "KPMG US", urn: "urn:li:organization:1" }, { name: "KPMG UK", urn: "urn:li:organization:2" }, { name: "KPMG", urn: "urn:li:title:5" }]
    expect(matchCompany(" kpmg us ", results).urn).toBe("urn:li:organization:1")
    expect(matchCompany("KPMG", results)).toEqual({ urn: null, candidates: results.slice(0, 2) })
  })

  it("builds the patch from the targeting read before, and says what changes", () => {
    const before: Before = { name: "LOIS", status: "ACTIVE", dailyBudget: 500, start: null, end: null, targetingCriteria: current }
    const body = campaignPatch({ kind: "exclude", facet: "seniorities", values: [entry] }, "USD", before) as { patch: { $set: { targetingCriteria: typeof current } } }
    expect(body.patch.$set.targetingCriteria.include).toEqual(current.include)
    expect(describeChange({ kind: "exclude", facet: "seniorities", values: [entry] }, before, String)).toEqual(["Excluded seniorities: + Entry"])
    // No targeting read (LinkedIn not connected): a dry run logs what it would add, nothing sendable.
    expect(campaignPatch({ kind: "exclude", facet: "seniorities", values: [entry] }, "USD", null)).toMatchObject({ unsent: expect.any(String) })
  })

  it("sends targeting only whole and on its own", async () => {
    const calls: { body: string }[] = []
    const f = (async (_url: string, init: RequestInit) => {
      calls.push({ body: String(init.body) })
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    const s = linkedInEditSender({ token: async () => "t", fetch: f })
    await s.patch("508", "77", { patch: { $set: { targetingCriteria: current } } })
    expect(JSON.parse(calls[0].body).patch.$set.targetingCriteria.include).toEqual(current.include)
    await expect(s.patch("508", "77", { patch: { $set: { targetingCriteria: { exclude: {} } } } })).rejects.toThrow(/targeting change/)
    await expect(s.patch("508", "77", { patch: { $set: { targetingCriteria: current, status: "PAUSED" } } })).rejects.toThrow(/targeting change/)
    await expect(s.patch("508", "77", { unsent: "x" })).rejects.toThrow(/Nothing to send/)
    expect(calls).toHaveLength(1)
  })

  it("logs a dry run with the targeting before and sends nothing", async () => {
    const logged: Record<string, unknown>[] = []
    const r = await runEdit(
      {
        env: { writesEnabled: true, dryRun: false, platforms: ["linkedin"], liveClients: null, editsEnabled: false },
        sender: { patch: async () => { throw new Error("should not send") } },
        store: { log: async (row) => (logged.push(row), { id: 1 }), finishLog: async () => {} },
      },
      { by: "me", client: { id: "c", slug: "filevine" }, accountId: "503169196", campaignId: "77", currency: "USD", change: { kind: "exclude", facet: "seniorities", values: [entry] }, before: { name: "x", status: "ACTIVE", dailyBudget: null, start: null, end: null, targetingCriteria: current }, money: String },
    )
    expect(r).toMatchObject({ ok: true, live: false, lines: ["Excluded seniorities: + Entry"] })
    expect(logged[0]).toMatchObject({ operation: "update_campaign", dry_run: true })
    expect((logged[0].previous as { targetingCriteria: unknown }).targetingCriteria).toEqual(current)
  })
})
