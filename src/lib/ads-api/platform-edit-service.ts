import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson, type Db } from "@/lib/supabase/db"
import { runAction } from "@/lib/windsor/mcp"
import { windsorRows } from "@/lib/windsor/rest"
import type { Platform } from "@/lib/metrics/types"
import { accessToken, USER_AGENT } from "./tokens"
import { money } from "@/lib/format"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"
import { adsApiEditsEnabled, adsApiEnv, editDryRunReason } from "./gates"
import { planEdit, runPlatformEdit, type EditPlatform, type PlatformBefore, type PlatformChange, type PlatformEditResult, type PlatformEditSender, type PlatformEditStore } from "./platform-edit"

// The server side of edits to live Google Ads, Meta, Reddit and Microsoft Ads campaigns (Dean,
// 2026-10-21): whether a campaign is the client's (from our own data, never the browser), the value
// before (read from Windsor), the senders and the write log.

const DAY = 864e5
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())

/** Our metrics don't hold Microsoft Ads yet, so none of its campaigns can be shown to be the client's. */
const reported = (p: EditPlatform): Platform | null => (p === "microsoft_ads" ? null : p)

/** The client's active account on the platform, with the Windsor connector it's read through. */
export async function platformAccount(clientId: string, platform: EditPlatform, accountId: string) {
  const p = reported(platform)
  if (!p || !/^[\w-]+$/.test(accountId)) return null
  const { data } = await createAdminClient().from("client_platform_accounts").select("external_account_id, windsor_connector").eq("client_id", clientId).eq("platform", p).eq("external_account_id", accountId).eq("active", true).maybeSingle()
  return data ? { accountId: data.external_account_id, connector: data.windsor_connector } : null
}

/** The client's campaign: in the status sync on a mapped account, built by the app, or with recent metrics there. */
export async function campaignOf(clientId: string, platform: EditPlatform, campaignId: string): Promise<{ accountId: string; connector: string; name: string; status: string | null } | null> {
  const p = reported(platform)
  if (!p || !/^[\w-]+$/.test(campaignId)) return null
  const db = createAdminClient()
  const { data } = await db.from("campaign_statuses").select("external_account_id, campaign_name, status").eq("client_id", clientId).eq("platform", p).eq("campaign_id", campaignId).maybeSingle()
  const acc = data ? await platformAccount(clientId, platform, data.external_account_id) : null
  if (data && acc) return { ...acc, name: data.campaign_name ?? campaignId, status: data.status }
  const { data: built } = await db.from("campaign_builds").select("external_account_id, name").eq("client_id", clientId).eq("platform", platform).contains("created_ids", { campaign: campaignId }).maybeSingle()
  const builtAcc = built ? await platformAccount(clientId, platform, built.external_account_id) : null
  if (built && builtAcc) return { ...builtAcc, name: built.name, status: null }
  const { data: seen } = await db.from("windsor_daily_metrics").select("external_account_id, campaign_name").eq("client_id", clientId).eq("platform", p).eq("campaign_id", campaignId).gte("date", isoDay(Date.now() - 90 * DAY)).order("date", { ascending: false }).limit(1).maybeSingle()
  const seenAcc = seen ? await platformAccount(clientId, platform, seen.external_account_id) : null
  if (seen && seenAcc) return { ...seenAcc, name: seen.campaign_name ?? campaignId, status: null }
  return null
}

/** Meta's targeting comes as JSON text or an object. */
export function targetingObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const t = JSON.parse(raw)
    return t && typeof t === "object" && !Array.isArray(t) ? (t as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Meta's money is in the currency's minor unit (cents). */
const fromMinor = (v: unknown) => (v === null || v === undefined || v === "" || !Number(v) ? null : Number(v) / 100)
const metaEnd = (v: unknown) => {
  const s = str(v)
  if (!s) return null
  const ms = /^\d+$/.test(s) ? Number(s) * 1000 : Date.parse(s)
  return Number.isFinite(ms) ? isoDay(ms) : null
}

/**
 * The campaign as the platform has it now, read from Windsor: name, status, daily budget (and for
 * Meta its ad sets with their budgets, end dates and whole targeting). Throws when Windsor can't be read.
 */
export async function readBefore(platform: EditPlatform, connector: string, accountId: string, campaignId: string): Promise<NonNullable<PlatformBefore>> {
  const today = Date.now()
  if (platform === "google_ads") {
    // One day, so budget_amount is the daily budget.
    const day = isoDay(today - DAY)
    const rows = (await windsorRows(connector, accountId, ["campaign_id", "campaign", "campaign_status", "budget_amount"], day, day, { timeoutMs: 60_000 })).filter((r) => str(r.campaign_id) === campaignId)
    const r = rows[0]
    if (!r) throw new Error("Windsor has no row for this campaign yesterday")
    return { name: str(r.campaign) || null, status: str(r.campaign_status) || null, dailyBudget: Number(r.budget_amount) || null }
  }
  if (platform === "meta") {
    const rows = (
      await windsorRows(connector, accountId, ["campaign_id", "campaign", "campaign_status", "campaign_daily_budget", "adset_id", "adset_name", "adset_status", "adset_daily_budget", "adset_end_time", "adset_targeting"], isoDay(today - 7 * DAY), isoDay(today), { timeoutMs: 90_000 })
    ).filter((r) => str(r.campaign_id) === campaignId)
    if (!rows.length) throw new Error("Windsor has no rows for this campaign in the last 7 days")
    const adSets = new Map<string, NonNullable<NonNullable<PlatformBefore>["adSets"]>[number]>()
    for (const r of rows) {
      const id = str(r.adset_id)
      if (!id) continue
      const t = targetingObject(r.adset_targeting)
      const prev = adSets.get(id)
      adSets.set(id, { id, name: str(r.adset_name) || id, status: str(r.adset_status) || null, dailyBudget: fromMinor(r.adset_daily_budget), end: metaEnd(r.adset_end_time), targeting: t ?? prev?.targeting ?? null })
    }
    const r = rows[0]
    return { name: str(r.campaign) || null, status: str(r.campaign_status) || null, dailyBudget: fromMinor(r.campaign_daily_budget), adSets: [...adSets.values()] }
  }
  if (platform === "reddit") {
    const rows = (await windsorRows(connector, accountId, ["campaign_id", "campaign", "campaign_effective_status"], isoDay(today - 7 * DAY), isoDay(today), { timeoutMs: 60_000 })).filter((r) => str(r.campaign_id) === campaignId)
    const r = rows[rows.length - 1]
    if (!r) throw new Error("Windsor has no rows for this campaign in the last 7 days")
    return { name: str(r.campaign) || null, status: str(r.campaign_effective_status) || null, dailyBudget: null }
  }
  throw new Error("Microsoft Ads isn't read through Windsor yet")
}

/** One Meta ad set's whole targeting, from Windsor, when the ad set is on the client's account. For builds that copy an audience. */
export async function metaAdSetTargeting(clientId: string, accountId: string, adSetId: string): Promise<Record<string, unknown> | null> {
  if (!/^\d+$/.test(adSetId)) return null
  const account = await platformAccount(clientId, "meta", accountId)
  if (!account) return null
  const rows = await windsorRows(account.connector, accountId, ["adset_id", "adset_targeting"], isoDay(Date.now() - 30 * DAY), isoDay(Date.now()), { timeoutMs: 90_000 })
  for (const r of rows) if (str(r.adset_id) === adSetId) {
    const t = targetingObject(r.adset_targeting)
    if (t) return t
  }
  return null
}

/** Sends planned edits: Windsor for Google, Meta and Microsoft; Reddit's own API (UNVERIFIED) for Reddit. */
export function platformEditSender(): PlatformEditSender | null {
  const key = process.env.WINDSOR_API_KEY
  return {
    async send(accountId, call) {
      if (call.via === "windsor") {
        if (!key) throw new Error("WINDSOR_API_KEY isn't set")
        return runAction(key, call.connector, call.action, accountId, call.params)
      }
      // Reddit Ads API v3, unverified (see reddit.ts): the only call is a campaign pause.
      if (!/^\/campaigns\/[\w-]+$/.test(call.path) || JSON.stringify(call.body) !== JSON.stringify({ configured_status: "PAUSED" })) throw new Error("That Reddit change isn't one Lumaux makes.")
      const response = await fetch(`https://ads-api.reddit.com/api/v3${call.path}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${await accessToken("reddit")}`, "User-Agent": USER_AGENT, "Content-Type": "application/json" },
        body: JSON.stringify({ data: call.body }),
        signal: AbortSignal.timeout(30_000),
      })
      const json = await response.json().catch(() => null)
      if (response.status >= 400 && response.status < 500) return { isError: true, result: json }
      if (!response.ok) throw new Error(`Reddit: ${response.status}`)
      return { isError: false, result: json }
    },
  }
}

/** platform_write_log, written as the person (createAdminClient(me.id)) so the change log names them. */
export function platformEditStore(db: Db): PlatformEditStore {
  return {
    async log(row) {
      const { data, error } = await db.from("platform_write_log").insert({ ...row, payload: toJson(row.payload), previous: toJson(row.previous) }).select("id").single()
      return error || !data ? { error: error?.message ?? "no row" } : { id: data.id }
    },
    async finishLog(id, v) {
      await db.from("platform_write_log").update({ success: v.success, response: toJson(v.response), completed_at: new Date().toISOString() }).eq("id", id)
    },
  }
}

/** The month's budget for a platform (client_budgets, else the accounts'), for the budget guard on edits. */
export async function monthBudget(clientId: string, platform: EditPlatform): Promise<number | null> {
  const p = reported(platform)
  if (!p) return null
  const db = createAdminClient()
  const month = `${new Date().toISOString().slice(0, 7)}-01`
  const { data } = await db.from("client_budgets").select("amount").eq("client_id", clientId).eq("platform", p).eq("month", month).eq("campaign_id", "").maybeSingle()
  if (data) return Number(data.amount)
  const { data: accounts } = await db.from("client_platform_accounts").select("monthly_budget").eq("client_id", clientId).eq("platform", p).eq("active", true)
  const total = (accounts ?? []).reduce((s, a) => s + Number(a.monthly_budget ?? 0), 0)
  return total > 0 ? total : null
}

export type EditPreview = { ok: true; name: string; live: boolean; reason: string | null; lines: string[]; before: PlatformBefore } | { ok: false; error: string }

type EditClient = { id: string; slug: string; currency: string }

/** What an edit would change, read from the platform first. Sends nothing. The caller has checked who may edit. */
export async function previewEdit(client: EditClient, platform: EditPlatform, campaignId: string, change: PlatformChange): Promise<EditPreview> {
  const campaign = await campaignOf(client.id, platform, campaignId)
  if (!campaign) return { ok: false, error: `That isn't one of this client's ${PLATFORM_LABEL[platform]} campaigns.` }
  const reason = editDryRunReason({ ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }, platform, client.slug)
  let before: PlatformBefore = null
  let readError: string | null = null
  try {
    before = await readBefore(platform, campaign.connector, campaign.accountId, campaignId)
  } catch (e) {
    readError = (e as Error).message
  }
  try {
    const planned = planEdit(platform, campaignId, change, before, (n) => money(n, client.currency))
    const live = reason === null && !readError
    return { ok: true, name: before?.name ?? campaign.name, live, reason: readError ? `Couldn't read the campaign from Windsor (${readError}), so this would only be logged.` : reason, lines: planned.lines, before }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Makes the edit: reads the value before (a live edit refuses without it), checks the budget guard,
 * logs, sends (or logs a dry run). As the person, for the change log. The caller has checked who may edit.
 */
export async function applyEdit(me: { id: string }, client: EditClient, platform: EditPlatform, campaignId: string, change: PlatformChange): Promise<PlatformEditResult> {
  const fail = (error: string): PlatformEditResult => ({ ok: false, live: false, lines: [], error })
  const campaign = await campaignOf(client.id, platform, campaignId)
  if (!campaign) return fail(`That isn't one of this client's ${PLATFORM_LABEL[platform]} campaigns.`)
  const limited = await rateLimit(await createClient(), "campaign_edit")
  if (limited) return fail(limited)
  const env = { ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }
  const live = editDryRunReason(env, platform, client.slug) === null
  let before: PlatformBefore = null
  try {
    before = await readBefore(platform, campaign.connector, campaign.accountId, campaignId)
  } catch (e) {
    if (live) return fail(`Couldn't read the campaign from Windsor first, so nothing was sent. ${(e as Error).message}`)
  }
  // The budget guard: a new daily budget can't add up to more than the month's budget for the platform.
  if (change.kind === "budget") {
    const month = await monthBudget(client.id, platform)
    if (month !== null && change.dailyBudget * 30 > month) return fail(`A daily budget of ${money(change.dailyBudget, client.currency)} adds up to more than this month's ${PLATFORM_LABEL[platform]} budget of ${money(month, client.currency)}.`)
  }
  return runPlatformEdit(
    { env, sender: live ? platformEditSender() : null, store: platformEditStore(createAdminClient(me.id)) },
    { by: me.id, platform, client: { id: client.id, slug: client.slug }, accountId: campaign.accountId, campaignId, change, before, money: (n) => money(n, client.currency) },
  )
}

const PLATFORM_LABEL: Record<EditPlatform, string> = { google_ads: "Google Ads", meta: "Meta", reddit: "Reddit", microsoft_ads: "Microsoft Ads" }
