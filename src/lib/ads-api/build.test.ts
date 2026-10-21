import { describe, expect, it, vi } from "vitest"
import { PlatformRefused, runBuild, type BuildStep, type BuildStore, type LogRow, type Sender } from "./build"
import { adsApiEnv, dryRunReason } from "./gates"

// A fake store that records every call. Never a real database.
function fakeStore(opts: { claim?: boolean; duplicateAt?: string; failLog?: boolean } = {}) {
  const logs: LogRow[] = []
  const finished: { id: number; values: Record<string, unknown> }[] = []
  const saved: Record<string, unknown>[] = []
  let next = 1
  const store: BuildStore = {
    claim: vi.fn(async () => opts.claim ?? true),
    log: vi.fn(async (row: LogRow) => {
      if (opts.failLog) return { error: "db down" }
      if (opts.duplicateAt === row.step) return { duplicate: true as const }
      logs.push(row)
      return { id: next++ }
    }),
    finishLog: vi.fn(async (id: number, values) => void finished.push({ id, values })),
    saveBuild: vi.fn(async (_id: string, values) => void saved.push(values)),
  }
  return { store, logs, finished, saved }
}

// A fake sender. Never a real platform.
function fakeSender(fail?: { at: string; refused: boolean }) {
  let n = 100
  const sent: { operation: string; payload: Record<string, unknown> }[] = []
  const sender: Sender = {
    send: vi.fn(async (operation, _account, payload) => {
      if (fail && payload.step === fail.at) throw fail.refused ? new PlatformRefused("LinkedIn refused it: bad budget") : new Error("timed out")
      sent.push({ operation, payload })
      return { id: String(n++), raw: { ok: true } }
    }),
  }
  return { sender, sent }
}

const steps: BuildStep[] = [
  { key: "group", operation: "create_campaign_group", payload: () => ({ step: "group" }) },
  { key: "campaign", operation: "create_campaign", payload: (ids) => ({ step: "campaign", group: ids.group }) },
  { key: "ad:0", operation: "create_ad", payload: (ids) => ({ step: "ad:0", campaign: ids.campaign }) },
]
const build = { id: "b1", platform: "linkedin" as const, external_account_id: "508073934", created_ids: {}, client: { id: "c1", slug: "dnsfilter" } }
const LIVE = adsApiEnv({ ADS_API_WRITES_ENABLED: "true", ADS_API_DRY_RUN: "false", ADS_API_PLATFORMS: "linkedin" })
const by = { id: "me" }

describe("gates", () => {
  it("default to a dry run", () => {
    expect(dryRunReason(adsApiEnv({}), "linkedin", "dnsfilter")).toMatch(/nothing was sent/)
    expect(dryRunReason(adsApiEnv({ ADS_API_WRITES_ENABLED: "true" }), "linkedin", "dnsfilter")).toMatch(/DRY_RUN/)
  })
  it("need the platform listed", () => {
    expect(dryRunReason(adsApiEnv({ ADS_API_WRITES_ENABLED: "true", ADS_API_DRY_RUN: "false" }), "linkedin", "dnsfilter")).toMatch(/ADS_API_PLATFORMS/)
    expect(dryRunReason(LIVE, "reddit", "dnsfilter")).toMatch(/ADS_API_PLATFORMS/)
  })
  it("respect the live clients list", () => {
    const env = adsApiEnv({ ADS_API_WRITES_ENABLED: "true", ADS_API_DRY_RUN: "false", ADS_API_PLATFORMS: "linkedin", ADS_API_LIVE_CLIENTS: "camber" })
    expect(dryRunReason(env, "linkedin", "dnsfilter")).toMatch(/LIVE_CLIENTS/)
    expect(dryRunReason(env, "linkedin", "Camber")).toBeNull()
  })
})

describe("runBuild", () => {
  it("dry run by default: logs every step, sends nothing, chains placeholder ids", async () => {
    const { store, logs, finished, saved } = fakeStore()
    const { sender } = fakeSender()
    const r = await runBuild({ store, sender, env: adsApiEnv({}) }, build, steps, by)
    expect(r.status).toBe("dry_run")
    expect(r.live).toBe(false)
    expect(sender.send).not.toHaveBeenCalled()
    expect(store.claim).not.toHaveBeenCalled()
    expect(logs.map((l) => [l.step, l.dry_run, l.idempotency_key])).toEqual([
      ["group", true, null],
      ["campaign", true, null],
      ["ad:0", true, null],
    ])
    expect(logs[1].payload).toEqual({ step: "campaign", group: "dry-1" })
    expect(finished.every((f) => f.values.success === true)).toBe(true)
    expect(saved.at(-1)).toMatchObject({ error: null })
    expect(saved.some((s) => "status" in s || "created_ids" in s)).toBe(false)
  })

  it("no sender means a dry run, even with the switches on", async () => {
    const { store } = fakeStore()
    const r = await runBuild({ store, sender: null, env: LIVE }, build, steps, by)
    expect(r.status).toBe("dry_run")
  })

  it("live: logs first, sends in order with real ids, keys each step", async () => {
    const { store, logs } = fakeStore()
    const { sender, sent } = fakeSender()
    const r = await runBuild({ store, sender, env: LIVE }, build, steps, by)
    expect(r.status).toBe("created")
    expect(sent.map((s) => s.payload)).toEqual([{ step: "group" }, { step: "campaign", group: "100" }, { step: "ad:0", campaign: "101" }])
    expect(logs.map((l) => l.idempotency_key)).toEqual(["build:b1:group", "build:b1:campaign", "build:b1:ad:0"])
    expect(logs[2].campaign_id).toBe("101")
    expect(r.ids).toEqual({ group: "100", campaign: "101", "ad:0": "102" })
  })

  it("resumes: steps that already worked are skipped", async () => {
    const { store, logs } = fakeStore()
    const { sender, sent } = fakeSender()
    const r = await runBuild({ store, sender, env: LIVE }, { ...build, created_ids: { group: "9", campaign: "10" } }, steps, by)
    expect(r.status).toBe("created")
    expect(logs.map((l) => l.step)).toEqual(["ad:0"])
    expect(sent[0].payload).toEqual({ step: "ad:0", campaign: "10" })
  })

  it("a clear refusal stops, frees the key and leaves what was made", async () => {
    const { store, finished } = fakeStore()
    const { sender } = fakeSender({ at: "campaign", refused: true })
    const r = await runBuild({ store, sender, env: LIVE }, build, steps, by)
    expect(r.status).toBe("partly_created")
    expect(r.ids).toEqual({ group: "100" })
    expect(finished.at(-1)?.values).toMatchObject({ success: false, clearKey: true })
    expect(sender.send).toHaveBeenCalledTimes(2)
  })

  it("an unknown outcome keeps the key and says to check the platform", async () => {
    const { store, finished } = fakeStore()
    const { sender } = fakeSender({ at: "group", refused: false })
    const r = await runBuild({ store, sender, env: LIVE }, build, steps, by)
    expect(r.status).toBe("failed")
    expect(r.error).toMatch(/check LinkedIn Campaign Manager/)
    expect(finished.at(-1)?.values.clearKey).toBe(false)
  })

  it("never sends a step whose key is taken", async () => {
    const { store } = fakeStore({ duplicateAt: "campaign" })
    const { sender } = fakeSender()
    const r = await runBuild({ store, sender, env: LIVE }, build, steps, by)
    expect(r.ok).toBe(false)
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(r.error).toMatch(/may have gone through/)
  })

  it("no log, no write", async () => {
    const { store } = fakeStore({ failLog: true })
    const { sender } = fakeSender()
    const r = await runBuild({ store, sender, env: LIVE }, build, steps, by)
    expect(r.ok).toBe(false)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it("refuses a build someone else is sending", async () => {
    const { store } = fakeStore({ claim: false })
    const { sender } = fakeSender()
    const r = await runBuild({ store, sender, env: LIVE }, build, steps, by)
    expect(r.status).toBe("busy")
    expect(sender.send).not.toHaveBeenCalled()
  })
})
