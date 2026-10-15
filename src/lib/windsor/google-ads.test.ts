import { describe, expect, it, vi } from "vitest"
import { createdAdId, createSearchAd, pauseAds, proofread, type SearchAdCopy } from "./google-ads"
import type { PushDb } from "./negatives"

// A fake Supabase that records every call, in order. Never a real database.
function fakeDb(opts: { failLogInsert?: boolean; duplicateKey?: boolean } = {}) {
  const calls: { table: string; op: string; args: unknown[] }[] = []
  let next = 1
  const db: PushDb = {
    from(table) {
      return {
        insert(row) {
          calls.push({ table, op: "insert", args: [row] })
          return { select: () => ({ single: async () => (opts.duplicateKey ? { data: null, error: { message: "duplicate key value", code: "23505" } } : opts.failLogInsert ? { data: null, error: { message: "db down" } } : { data: { id: next++ }, error: null }) }) }
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

// A fake Windsor that can only create paused ads and pause ads. Never the real one.
const fakeWindsor = (isError = false) => ({
  createSearchAd: vi.fn(async () => ({ isError, result: { content: [{ type: "text", text: isError ? "ad group not found" : "created 148312638842~812345678901" }] } })),
  pauseAd: vi.fn(async () => ({ isError, result: { content: [{ type: "text", text: isError ? "ad not found" : "paused" }] } })),
})

const LIVE = { writesEnabled: true, dryRun: false, adWritesEnabled: true }
const target = { client: { id: "client-dns", slug: "dnsfilter" }, accountId: "304-054-6900", campaignId: "18503537255", testId: "test-1", by: { id: "me" } }

const copy: SearchAdCopy = {
  headlines: ["DNS Filtering for SMBs", "Deploy in Minutes", "No Hardware Needed", "", ""],
  descriptions: ["Block threats before they reach your network. Start a free trial, no card needed.", "Trusted by 45,000+ organizations. Sub-30ms Anycast resolution."],
  finalUrl: "https://www.dnsfilter.com/free-trial",
  path1: "dns-filtering",
  path2: "",
}

describe("proofread", () => {
  it("passes clean copy", () => {
    expect(proofread(copy).filter((p) => p.blocking)).toEqual([])
  })
  it("blocks Google's limits and rules", () => {
    const bad = proofread({ ...copy, headlines: ["A headline that is far too long for Google", "Free trial!", "Free trial!"], descriptions: ["Only one"], finalUrl: "dnsfilter.com", path2: "x" })
    const problems = bad.filter((p) => p.blocking).map((p) => p.problem)
    expect(problems.some((p) => p.includes("limit is 30"))).toBe(true)
    expect(problems.some((p) => p.includes("\"!\""))).toBe(true)
    expect(problems.some((p) => p.startsWith("Same text"))).toBe(true)
    expect(problems.some((p) => p.includes("at least 2 descriptions"))).toBe(true)
    expect(problems.some((p) => p.includes("https://"))).toBe(true)
    expect(problems.some((p) => p.includes("Path 2 needs Path 1"))).toBe(false)
  })
  it("warns about doubled words and two different numbers for one claim", () => {
    const w = proofread({ ...copy, headlines: ["Over Over 40K+ Orgs", "Trusted by 43,000+ Orgs", "Deploy in Minutes"] }).filter((p) => !p.blocking)
    expect(w.some((p) => p.problem.includes("\"Over\" is written twice"))).toBe(true)
    expect(w.some((p) => p.where === "Numbers" && p.problem.includes("org"))).toBe(true)
  })
})

describe("createSearchAd", () => {
  it("logs and sends nothing while ad writes are off, even with negatives live", async () => {
    const { db, calls } = fakeDb()
    const windsor = fakeWindsor()
    const r = await createSearchAd({ db, windsor, env: { ...LIVE, adWritesEnabled: false } }, { ...target, adGroupId: "148312638842", copy })
    expect(r.live).toBe(false)
    expect(r.writes[0].status).toBe("dry_run")
    expect(windsor.createSearchAd).not.toHaveBeenCalled()
    expect(calls[0]).toMatchObject({ table: "platform_write_log", op: "insert" })
    expect((calls[0].args[0] as { dry_run: boolean }).dry_run).toBe(true)
  })
  it("always creates the ad paused, logs first, and records the new ad id", async () => {
    const { db, calls } = fakeDb()
    const windsor = fakeWindsor()
    const r = await createSearchAd({ db, windsor, env: LIVE }, { ...target, adGroupId: "148312638842", copy })
    expect(r).toMatchObject({ ok: true, live: true })
    expect(r.writes[0]).toMatchObject({ status: "sent", adId: "812345678901" })
    const sent = windsor.createSearchAd.mock.calls[0] as unknown as [string, { status: string; headlines: string[] }]
    expect(sent[1].status).toBe("paused")
    expect(sent[1].headlines).toEqual(["DNS Filtering for SMBs", "Deploy in Minutes", "No Hardware Needed"])
    expect(calls.map((c) => c.op)).toEqual(["insert", "update"])
    expect(calls[0].args[0]).toMatchObject({ operation: "create_responsive_search_ad", sprint_test_id: "test-1", dry_run: false })
    expect(calls[1].args[0]).toMatchObject({ success: true, ad_id: "812345678901" })
  })
  it("never calls Windsor when the log can't be written", async () => {
    const { db } = fakeDb({ failLogInsert: true })
    const windsor = fakeWindsor()
    const r = await createSearchAd({ db, windsor, env: LIVE }, { ...target, adGroupId: "148312638842", copy })
    expect(r.ok).toBe(false)
    expect(windsor.createSearchAd).not.toHaveBeenCalled()
  })
  it("refuses copy that fails a blocking check, before logging", async () => {
    const { db, calls } = fakeDb()
    const windsor = fakeWindsor()
    const r = await createSearchAd({ db, windsor, env: LIVE }, { ...target, adGroupId: "148312638842", copy: { ...copy, headlines: ["Only one"] } })
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
    expect(windsor.createSearchAd).not.toHaveBeenCalled()
  })
  it("refuses a second create with the same key, without calling Windsor", async () => {
    const { db } = fakeDb({ duplicateKey: true })
    const windsor = fakeWindsor()
    const r = await createSearchAd({ db, windsor, env: LIVE }, { ...target, idempotencyKey: "k1", adGroupId: "148312638842", copy })
    expect(r.ok).toBe(false)
    expect(r.writes[0].error).toContain("already created")
    expect(windsor.createSearchAd).not.toHaveBeenCalled()
  })
  it("logs the key, and frees it when Google refuses so it can be tried again", async () => {
    const { db, calls } = fakeDb()
    const r = await createSearchAd({ db, windsor: fakeWindsor(true), env: LIVE }, { ...target, idempotencyKey: "k1", adGroupId: "148312638842", copy })
    expect(r.ok).toBe(false)
    expect(calls[0].args[0]).toMatchObject({ idempotency_key: "k1" })
    expect(calls[1].args[0]).toMatchObject({ success: false, idempotency_key: null })
  })
  it("keeps the key when the outcome is uncertain (a timeout may still have created the ad)", async () => {
    const { db, calls } = fakeDb()
    const windsor = { ...fakeWindsor(), createSearchAd: vi.fn(async () => { throw new Error("timeout") }) }
    const r = await createSearchAd({ db, windsor, env: LIVE }, { ...target, idempotencyKey: "k1", adGroupId: "148312638842", copy })
    expect(r.ok).toBe(false)
    expect(r.writes[0].error).toContain("may still have created")
    expect(calls[1].args[0]).not.toHaveProperty("idempotency_key")
  })
  it("respects WINDSOR_LIVE_CLIENTS", async () => {
    const { db } = fakeDb()
    const windsor = fakeWindsor()
    const r = await createSearchAd({ db, windsor, env: { ...LIVE, liveClients: ["camber"] } }, { ...target, adGroupId: "148312638842", copy })
    expect(r.writes[0].status).toBe("dry_run")
    expect(windsor.createSearchAd).not.toHaveBeenCalled()
  })
})

describe("pauseAds", () => {
  it("pauses each ad once, one log row each", async () => {
    const { db, calls } = fakeDb()
    const windsor = fakeWindsor()
    const ads = [
      { adGroupId: "148312638842", adId: "650357909670" },
      { adGroupId: "148312638842", adId: "650357909670" },
      { adGroupId: "148312638842", adId: "650357909671" },
    ]
    const r = await pauseAds({ db, windsor, env: LIVE }, { ...target, ads })
    expect(r.ok).toBe(true)
    expect(windsor.pauseAd).toHaveBeenCalledTimes(2)
    expect(calls.filter((c) => c.op === "insert").map((c) => (c.args[0] as { operation: string; ad_id: string }).ad_id)).toEqual(["650357909670", "650357909671"])
  })
  it("reports a refusal as failed", async () => {
    const { db } = fakeDb()
    const r = await pauseAds({ db, windsor: fakeWindsor(true), env: LIVE }, { ...target, ads: [{ adGroupId: "1", adId: "2" }] })
    expect(r.ok).toBe(false)
    expect(r.writes[0]).toMatchObject({ status: "failed", error: "ad not found" })
  })
})

it("reads the new ad id from Windsor's reply", () => {
  expect(createdAdId({ content: [{ type: "text", text: '{"resource": "148312638842~812345678901"}' }] })).toBe("812345678901")
  expect(createdAdId(null)).toBe(null)
})
