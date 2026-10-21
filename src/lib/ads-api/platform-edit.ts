import { editDryRunReason, type AdsApiEnv } from "./gates"

/**
 * Edits to live campaigns on Google Ads, Meta, Reddit and Microsoft Ads (Dean, 2026-10-21; LinkedIn
 * has edit.ts). One edit = one platform_write_log row, written first with the value before (read
 * from Windsor) and the exact call; then sent; then the result. What can change:
 *   - every platform: pause the campaign (never enable: status can only become paused)
 *   - Google Ads and Microsoft Ads: the campaign's daily budget; Google: rename, add keywords to an ad group
 *   - Meta: the daily budget (the campaign's when it carries one, else the ad set's), rename the
 *     campaign, pause an ad set, an ad set's end date, and three targeting fixes that read the ad
 *     set's WHOLE targeting first and change one thing: Audience Network off, Advantage+ audience
 *     off, the age range. Meta replaces the whole targeting on update, so nothing else may move.
 * Google and Meta go through Windsor (write-guard.ts), Microsoft through Windsor's bing actions,
 * Reddit through its own API (UNVERIFIED, pause only). A plain module so the tests can use it.
 */

export type EditPlatform = "google_ads" | "meta" | "reddit" | "microsoft_ads"

export type PlatformChange =
  | { kind: "pause" }
  | { kind: "budget"; dailyBudget: number; adSetId?: string }
  | { kind: "rename"; name: string }
  | { kind: "pause_ad_set"; adSetId: string }
  | { kind: "ad_set_end"; adSetId: string; endDate: string }
  | { kind: "targeting"; adSetId: string; fix: "audience_network_off" | "advantage_off" | "ages"; ageMin?: number; ageMax?: number }
  | { kind: "keywords"; adGroupId: string; adGroupName?: string; keywords: { text: string; match: "EXACT" | "PHRASE" }[] }

export type AdSetBefore = { id: string; name: string; status: string | null; dailyBudget: number | null; end: string | null; targeting: Record<string, unknown> | null }
export type PlatformBefore = { name: string | null; status: string | null; dailyBudget: number | null; adSets?: AdSetBefore[] } | null

/** Which changes each platform offers. */
export const EDITS: Record<EditPlatform, PlatformChange["kind"][]> = {
  google_ads: ["pause", "budget", "rename", "keywords"],
  meta: ["pause", "budget", "rename", "pause_ad_set", "ad_set_end", "targeting"],
  reddit: ["pause"],
  microsoft_ads: ["pause", "budget"],
}

export type EditCall =
  | { via: "windsor"; connector: "google_ads" | "facebook" | "bing"; action: string; params: Record<string, unknown> }
  | { via: "reddit"; path: string; body: Record<string, unknown> }

export type PlannedEdit = { call: EditCall; operation: "pause_campaign" | "update_campaign" | "pause_ad_set" | "update_ad_set" | "add_keywords"; lines: string[]; adSetId?: string }

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const PAUSED = /paused|archived|completed|removed|deleted/i
const micros = (n: number) => Math.round(n * 1_000_000)
const minor = (n: number) => Math.round(n * 100)

/**
 * The ad set's targeting with one fix applied. Refuses when the targeting wasn't read (replacing it
 * would wipe the audience) or when there's nothing to change.
 */
export function fixTargeting(current: unknown, fix: "audience_network_off" | "advantage_off" | "ages", ages?: { ageMin?: number; ageMax?: number }) {
  if (!isObject(current) || !isObject(current.geo_locations)) throw new Error("Couldn't read the ad set's current targeting from Windsor, so nothing can be changed.")
  const t: Record<string, unknown> = { ...current }
  if (fix === "audience_network_off") {
    const platforms = Array.isArray(t.publisher_platforms) ? (t.publisher_platforms as unknown[]).map(String) : null
    if (platforms && !platforms.includes("audience_network")) throw new Error("The Audience Network is already off on this ad set.")
    // Automatic placements (no list) include the Audience Network: name Facebook and Instagram instead.
    t.publisher_platforms = platforms ? platforms.filter((p) => p !== "audience_network") : ["facebook", "instagram"]
    delete t.audience_network_positions
    const line = platforms ? `Placements: ${platforms.join(", ")} → ${(t.publisher_platforms as string[]).join(", ")}` : "Placements: automatic → facebook, instagram"
    return { targeting: t, lines: [line] }
  }
  if (fix === "advantage_off") {
    const auto = isObject(t.targeting_automation) ? t.targeting_automation : {}
    if (Number(auto.advantage_audience ?? 0) === 0 && "advantage_audience" in auto) throw new Error("Advantage+ audience is already off on this ad set.")
    t.targeting_automation = { ...auto, advantage_audience: 0 }
    return { targeting: t, lines: [`Advantage+ audience: ${auto.advantage_audience === undefined ? "not set" : "on"} → off`] }
  }
  const min = ages?.ageMin
  const max = ages?.ageMax
  if (min === undefined && max === undefined) throw new Error("Pick the new age range.")
  const ageMin = min ?? Number(t.age_min ?? 18)
  const ageMax = max ?? Number(t.age_max ?? 65)
  if (!(ageMin >= 18 && ageMax <= 65 && ageMin <= ageMax)) throw new Error("Ages run from 18 to 65, youngest first.")
  if (ageMin === Number(t.age_min ?? 18) && ageMax === Number(t.age_max ?? 65)) throw new Error("That's the age range it has now.")
  const lines = [`Ages: ${t.age_min ?? 18}-${t.age_max ?? 65} → ${ageMin}-${ageMax}`]
  if (isObject(t.targeting_automation) && Number(t.targeting_automation.advantage_audience) === 1) lines.push("Advantage+ audience is on, so Meta treats ages as a suggestion.")
  t.age_min = ageMin
  t.age_max = ageMax
  return { targeting: t, lines }
}

/** The call one change makes, and the before → after lines. Throws with a plain reason when it can't be made. */
export function planEdit(platform: EditPlatform, campaignId: string, change: PlatformChange, before: PlatformBefore, money: (n: number) => string): PlannedEdit {
  if (!EDITS[platform].includes(change.kind)) throw new Error("That change isn't one Lumaux makes on this platform.")
  if (!/^[\w-]+$/.test(campaignId)) throw new Error("That isn't a campaign id.")
  const adSet = (id: string) => {
    if (!/^\d+$/.test(id)) throw new Error("That isn't an ad set id.")
    const found = before?.adSets?.find((a) => a.id === id)
    if (!found) throw new Error("That ad set isn't in this campaign.")
    return found
  }
  switch (change.kind) {
    case "pause": {
      if (before?.status && PAUSED.test(before.status)) throw new Error("This campaign is already paused.")
      const lines = [`Status: ${before?.status ?? "unknown"} → PAUSED`]
      if (platform === "reddit") return { call: { via: "reddit", path: `/campaigns/${campaignId}`, body: { configured_status: "PAUSED" } }, operation: "pause_campaign", lines }
      const connector = platform === "meta" ? "facebook" : platform === "microsoft_ads" ? "bing" : "google_ads"
      return { call: { via: "windsor", connector, action: "pause_campaign", params: { campaign_id: campaignId } }, operation: "pause_campaign", lines }
    }
    case "budget": {
      const n = change.dailyBudget
      if (!(n > 0 && n < 1_000_000)) throw new Error("Enter a daily budget above 0.")
      if (platform === "google_ads") return { call: { via: "windsor", connector: "google_ads", action: "set_campaign_budget", params: { campaign_id: campaignId, budget_type: "daily", amount_micros: micros(n) } }, operation: "update_campaign", lines: [`Daily budget: ${before?.dailyBudget != null ? money(before.dailyBudget) : "unknown"} → ${money(n)}`] }
      if (platform === "microsoft_ads") return { call: { via: "windsor", connector: "bing", action: "set_campaign_budget", params: { campaign_id: campaignId, amount: n } }, operation: "update_campaign", lines: [`Daily budget: ${before?.dailyBudget != null ? money(before.dailyBudget) : "unknown"} → ${money(n)}`] }
      // Meta: the campaign's budget when it carries one (Advantage campaign budget), else the ad set's.
      if (before?.dailyBudget != null && !change.adSetId) return { call: { via: "windsor", connector: "facebook", action: "set_campaign_budget", params: { campaign_id: campaignId, budget_type: "daily", amount: minor(n) } }, operation: "update_campaign", lines: [`Campaign daily budget: ${money(before.dailyBudget)} → ${money(n)}`] }
      if (!change.adSetId) throw new Error("This campaign's budget is set on its ad sets: pick the ad set.")
      const a = adSet(change.adSetId)
      if (a.dailyBudget == null) throw new Error("That ad set has no daily budget of its own (it may use a lifetime budget). Change it in Ads Manager.")
      return { call: { via: "windsor", connector: "facebook", action: "set_adset_budget", params: { adset_id: a.id, budget_type: "daily", amount: minor(n) } }, operation: "update_ad_set", adSetId: a.id, lines: [`${a.name} daily budget: ${money(a.dailyBudget)} → ${money(n)}`] }
    }
    case "rename": {
      const name = change.name.trim()
      if (!name || name.length > 255 || /[\n\r]/.test(name)) throw new Error("A campaign name is 1 to 255 characters on one line.")
      if (before?.name === name) throw new Error("That's its name now.")
      const lines = [`Name: ${before?.name ?? "unknown"} → ${name}`]
      if (platform === "google_ads") return { call: { via: "windsor", connector: "google_ads", action: "rename_campaign", params: { campaign_id: campaignId, name } }, operation: "update_campaign", lines }
      return { call: { via: "windsor", connector: "facebook", action: "update_campaign", params: { campaign_id: campaignId, name } }, operation: "update_campaign", lines }
    }
    case "pause_ad_set": {
      const a = adSet(change.adSetId)
      if (a.status && PAUSED.test(a.status)) throw new Error("This ad set is already paused.")
      return { call: { via: "windsor", connector: "facebook", action: "pause_adset", params: { adset_id: a.id } }, operation: "pause_ad_set", adSetId: a.id, lines: [`${a.name}: ${a.status ?? "unknown"} → PAUSED`] }
    }
    case "ad_set_end": {
      const a = adSet(change.adSetId)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(change.endDate)) throw new Error("Use YYYY-MM-DD for the end date.")
      return { call: { via: "windsor", connector: "facebook", action: "update_adset", params: { adset_id: a.id, end_time: `${change.endDate}T23:59:59+0000` } }, operation: "update_ad_set", adSetId: a.id, lines: [`${a.name} end date: ${a.end ?? "none"} → ${change.endDate}`] }
    }
    case "targeting": {
      const a = adSet(change.adSetId)
      const { targeting, lines } = fixTargeting(a.targeting, change.fix, change)
      return { call: { via: "windsor", connector: "facebook", action: "update_adset", params: { adset_id: a.id, targeting } }, operation: "update_ad_set", adSetId: a.id, lines: lines.map((l) => `${a.name}: ${l}`) }
    }
    case "keywords": {
      if (!/^\d+$/.test(change.adGroupId)) throw new Error("That isn't an ad group id.")
      const seen = new Set<string>()
      const keywords = change.keywords
        .map((k) => ({ text: k.text.trim().toLowerCase().replace(/\s+/g, " "), match: k.match }))
        .filter((k) => k.text && k.text.length <= 80 && k.text.split(" ").length <= 10 && !seen.has(`${k.match}:${k.text}`) && seen.add(`${k.match}:${k.text}`))
      if (!keywords.length) throw new Error("Pick the search terms to add.")
      if (keywords.length > 500) throw new Error("Add at most 500 keywords at a time.")
      return {
        call: { via: "windsor", connector: "google_ads", action: "push_keywords", params: { ad_group_id: change.adGroupId, keywords: keywords.map((k) => ({ text: k.text, match_type: k.match })), status: "enabled" } },
        operation: "add_keywords",
        lines: [`${change.adGroupName ?? `Ad group ${change.adGroupId}`}: + ${keywords.map((k) => (k.match === "EXACT" ? `[${k.text}]` : `"${k.text}"`)).join(", ")}`],
      }
    }
  }
}

export type PlatformEditStore = {
  log(row: { profile_id: string; client_id: string; platform: EditPlatform; external_account_id: string; campaign_id: string; operation: PlannedEdit["operation"]; payload: Record<string, unknown>; previous: unknown; dry_run: boolean }): Promise<{ id: number } | { error: string }>
  finishLog(id: number, values: { success: boolean; response: unknown }): Promise<void>
}
/** Sends one planned call. Windsor's refusals come back as { isError: true }. */
export type PlatformEditSender = { send(accountId: string, call: EditCall): Promise<{ isError: boolean; result: unknown }> }

export type PlatformEditResult = { ok: boolean; live: boolean; lines: string[]; error?: string; logId?: number }

const PLATFORM_WORDS: Record<EditPlatform, string> = { google_ads: "Google Ads", meta: "Meta Ads Manager", reddit: "Reddit Ads", microsoft_ads: "Microsoft Advertising" }

/** Logs first, then sends (live) or stops (dry run), then logs the result. */
export async function runPlatformEdit(
  deps: { store: PlatformEditStore; sender: PlatformEditSender | null; env: AdsApiEnv & { editsEnabled?: boolean } },
  o: { by: string; platform: EditPlatform; client: { id: string; slug: string }; accountId: string; campaignId: string; change: PlatformChange; before: PlatformBefore; money: (n: number) => string },
): Promise<PlatformEditResult> {
  let planned: PlannedEdit
  try {
    planned = planEdit(o.platform, o.campaignId, o.change, o.before, o.money)
  } catch (e) {
    return { ok: false, live: false, lines: [], error: (e as Error).message }
  }
  const reason = editDryRunReason(deps.env, o.platform, o.client.slug)
  const live = reason === null && deps.sender !== null
  const logged = await deps.store.log({
    profile_id: o.by,
    client_id: o.client.id,
    platform: o.platform,
    external_account_id: o.accountId,
    campaign_id: o.campaignId,
    operation: planned.operation,
    payload: planned.call as unknown as Record<string, unknown>,
    previous: o.before,
    dry_run: !live,
  })
  if ("error" in logged) return { ok: false, live, lines: planned.lines, error: "Couldn't write the log, so nothing was sent." }
  if (!live || !deps.sender) {
    await deps.store.finishLog(logged.id, { success: true, response: { dry_run: true, note: reason ?? "No sender: nothing was sent" } })
    return { ok: true, live: false, lines: planned.lines, logId: logged.id }
  }
  try {
    const r = await deps.sender.send(o.accountId, planned.call)
    await deps.store.finishLog(logged.id, { success: !r.isError, response: r.result })
    if (r.isError) return { ok: false, live: true, lines: planned.lines, error: `${PLATFORM_WORDS[o.platform]} refused the change: nothing changed.`, logId: logged.id }
    return { ok: true, live: true, lines: planned.lines, logId: logged.id }
  } catch (e) {
    const message = (e as Error).message
    await deps.store.finishLog(logged.id, { success: false, response: { error: message } })
    return { ok: false, live: true, lines: planned.lines, error: `${message}. Check ${PLATFORM_WORDS[o.platform]}: the change may or may not have gone through.`, logId: logged.id }
  }
}
