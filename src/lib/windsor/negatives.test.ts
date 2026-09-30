import { describe, expect, it, vi } from "vitest"
import { buildPushes, pushNegativeKeywords, validateNegatives, type NegativeInput, type PushDb, type PushDeps } from "./negatives"

// A fake Supabase that records every call, in order. Never a real database.
function fakeDb(opts: { failLogInsert?: boolean } = {}) {
  const calls: { table: string; op: string; args: unknown[] }[] = []
  let next = 1
  const db: PushDb = {
    from(table) {
      return {
        insert(row) {
          calls.push({ table, op: "insert", args: [row] })
          return { select: () => ({ single: async () => (opts.failLogInsert ? { data: null, error: { message: "db down" } } : { data: { id: next++ }, error: null }) }) }
        },
        update(values) {
          return {
            eq: async (col, val) => {
              calls.push({ table, op: "update", args: [values, col, val] })
              return { error: null }
            },
          }
        },
      }
    },
  }
  return { db, calls }
}

// A fake Windsor that can only push negatives. Never the real one.
const fakeWindsor = (isError = false) => ({ pushNegativeKeywords: vi.fn(async () => ({ isError, result: { content: [{ type: "text", text: isError ? "campaign not found" : "added 2" }] } })) })

const input: NegativeInput = {
  client: { id: "client-dns", slug: "dnsfilter" },
  accountId: "304-054-6900",
  campaignId: "24084443163",
  level: "ad_group",
  matchType: "EXACT",
  terms: [
    { text: "Free DNS  server", adGroupId: "198524806443" },
    { text: "dns filter jobs", adGroupId: "198524806443" },
    { text: "dnsfilter pricing reddit", adGroupId: "202687486470" },
  ],
  by: { id: "p-andrea" },
}

const deps = (over: Partial<PushDeps["env"]> = {}, windsor: PushDeps["windsor"] = fakeWindsor(), failLogInsert = false) => {
  const { db, calls } = fakeDb({ failLogInsert })
  return { deps: { db, windsor, env: { writesEnabled: false, dryRun: true, liveClients: null, ...over } } satisfies PushDeps, calls, windsor }
}

describe("buildPushes", () => {
  it("sends one push per ad group, cleaned and de-duplicated", () => {
    const p = buildPushes({ ...input, terms: [...input.terms, { text: "free dns server", adGroupId: "198524806443" }] })
    expect(p).toEqual([
      { level: "ad_group", ad_group_id: "198524806443", keywords: [{ text: "free dns server", match_type: "EXACT" }, { text: "dns filter jobs", match_type: "EXACT" }] },
      { level: "ad_group", ad_group_id: "202687486470", keywords: [{ text: "dnsfilter pricing reddit", match_type: "EXACT" }] },
    ])
  })
  it("sends one push for the campaign at campaign level", () => {
    const p = buildPushes({ ...input, level: "campaign", matchType: "PHRASE" })
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ level: "campaign", campaign_id: "24084443163" })
    expect(p[0].keywords).toHaveLength(3)
  })
  it("splits over 500 terms", () => {
    const terms = Array.from({ length: 1200 }, (_, i) => ({ text: `term ${i}`, adGroupId: "1" }))
    expect(buildPushes({ ...input, level: "campaign", terms }).map((p) => p.keywords.length)).toEqual([500, 500, 200])
  })
})

describe("validateNegatives", () => {
  it("refuses terms Google would refuse", () => {
    expect(validateNegatives({ ...input, terms: [{ text: "a b c d e f g h i j k", adGroupId: "1" }] })).toMatch(/10 words/)
    expect(validateNegatives({ ...input, terms: [{ text: "x".repeat(81), adGroupId: "1" }] })).toMatch(/80 characters/)
    expect(validateNegatives({ ...input, terms: [] })).toMatch(/at least one/)
  })
  it("needs the ad group at ad group level", () => {
    expect(validateNegatives({ ...input, terms: [{ text: "free", adGroupId: "" }] })).toMatch(/campaign level/)
    expect(validateNegatives({ ...input, level: "campaign", terms: [{ text: "free", adGroupId: "" }] })).toBeNull()
  })
})

describe("pushNegativeKeywords", () => {
  it("is a dry run by default: logs every push, never calls Windsor", async () => {
    const { deps: d, calls, windsor } = deps()
    const r = await pushNegativeKeywords(d, input)
    expect(r).toMatchObject({ ok: true, live: false })
    expect(r.pushes.map((p) => p.status)).toEqual(["dry_run", "dry_run"])
    expect(windsor!.pushNegativeKeywords).not.toHaveBeenCalled()
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(2)
    expect(calls[0].args[0]).toMatchObject({ platform: "google_ads", operation: "push_negative_keywords", dry_run: true, ad_group_id: "198524806443" })
  })

  it("needs both switches", async () => {
    for (const env of [{ writesEnabled: true, dryRun: true }, { writesEnabled: false, dryRun: false }]) {
      const { deps: d, windsor } = deps(env)
      await pushNegativeKeywords(d, input)
      expect(windsor!.pushNegativeKeywords).not.toHaveBeenCalled()
    }
  })

  it("stays a dry run for clients outside WINDSOR_LIVE_CLIENTS", async () => {
    const { deps: d, windsor } = deps({ writesEnabled: true, dryRun: false, liveClients: ["camber"] })
    const r = await pushNegativeKeywords(d, input)
    expect(r.live).toBe(false)
    expect(windsor!.pushNegativeKeywords).not.toHaveBeenCalled()
  })

  it("when live: logs first, then pushes, then records the result", async () => {
    const { deps: d, calls, windsor } = deps({ writesEnabled: true, dryRun: false })
    const order: string[] = []
    windsor!.pushNegativeKeywords = vi.fn(async () => {
      order.push(`push after ${calls.filter((c) => c.op === "insert").length} log rows`)
      return { isError: false, result: { ok: true } }
    })
    const r = await pushNegativeKeywords(d, input)
    expect(r).toMatchObject({ ok: true, live: true })
    expect(order).toEqual(["push after 1 log rows", "push after 2 log rows"])
    expect(windsor!.pushNegativeKeywords).toHaveBeenCalledWith("304-054-6900", expect.objectContaining({ level: "ad_group", ad_group_id: "198524806443" }))
    expect(calls.filter((c) => c.op === "update").every((c) => (c.args[0] as { success: boolean }).success)).toBe(true)
  })

  it("never calls Windsor when the log can't be written", async () => {
    const { deps: d, windsor } = deps({ writesEnabled: true, dryRun: false }, fakeWindsor(), true)
    const r = await pushNegativeKeywords(d, input)
    expect(r.ok).toBe(false)
    expect(windsor!.pushNegativeKeywords).not.toHaveBeenCalled()
  })

  it("reports Windsor's refusal", async () => {
    const { deps: d, calls } = deps({ writesEnabled: true, dryRun: false }, fakeWindsor(true))
    const r = await pushNegativeKeywords(d, { ...input, level: "campaign" })
    expect(r.ok).toBe(false)
    expect(r.pushes[0]).toMatchObject({ status: "failed", error: "campaign not found" })
    expect(calls.at(-1)!.args[0]).toMatchObject({ success: false })
  })
})

describe("suggested negatives (ICP check)", async () => {
  const { checkRoot, negativeBlocks } = await import("@/lib/insights/term-review-rules")
  it("follows Google's matching, with no close variants", () => {
    expect(negativeBlocks("dns jobs", "EXACT", "dns jobs")).toBe(true)
    expect(negativeBlocks("dns jobs", "EXACT", "dns job")).toBe(false)
    expect(negativeBlocks("jobs", "PHRASE", "dnsfilter jobs remote")).toBe(true)
    expect(negativeBlocks("filter jobs", "PHRASE", "jobs filter")).toBe(false)
    expect(negativeBlocks("filter jobs", "BROAD", "jobs at dns filter")).toBe(true)
  })
  it("marks a negative unsafe when it blocks a term that converted", () => {
    const seen = [
      { text: "dns filter free trial", spend: 120, results: 2 },
      { text: "free dns server", spend: 40, results: 0 },
      { text: "free dns for home", spend: 25, results: 0 },
    ]
    expect(checkRoot({ text: "free", matchType: "PHRASE" }, seen)).toMatchObject({ blocked: 3, unsafe: expect.stringContaining("dns filter free trial") })
    expect(checkRoot({ text: "free dns", matchType: "PHRASE" }, seen)).toEqual({ blocked: 2, blockedSpend: 65, unsafe: null })
  })
})
