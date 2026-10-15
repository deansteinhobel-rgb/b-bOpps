/**
 * Google Ads ad writes from a sprint test (Dean, 2026-10-15): the app may CREATE a responsive search
 * ad (always paused) and PAUSE an existing ad, through Windsor's `create_responsive_search_ad` and
 * `pause_ad` actions. Nothing is enabled, edited, removed or deleted, and no other action exists here.
 * Pinning headlines and Google experiments aren't in Windsor's actions: the team does those in Google Ads.
 *
 * Same rules as negatives.ts: every write 1) logs to platform_write_log first, 2) calls Windsor only
 * when WINDSOR_WRITES_ENABLED=true and WINDSOR_DRY_RUN=false AND its own switch,
 * WINDSOR_AD_WRITES_ENABLED=true (off by default, so negatives being live doesn't make ads live), and,
 * while WINDSOR_LIVE_CLIENTS is set, only for those clients, 3) updates the log with the result.
 * No log, no write. Plain module (no server imports), so it can be tested with fakes.
 */
import { resultText, type PushDb } from "./negatives"

export const HEADLINE_MAX = 30
export const DESCRIPTION_MAX = 90
export const PATH_MAX = 15
export const HEADLINES = { min: 3, max: 15 }
export const DESCRIPTIONS = { min: 2, max: 4 }

export type SearchAdCopy = { headlines: string[]; descriptions: string[]; finalUrl: string; path1: string; path2: string }
export type CreateAdParams = { ad_group_id: string; headlines: string[]; descriptions: string[]; final_url: string; path1: string | null; path2: string | null; status: "paused" }
export type PauseAdParams = { ad_group_id: string; ad_id: string }

export type AdWriteDeps = {
  db: PushDb
  /** Only created when ad writes are live. It can only create paused search ads and pause ads. */
  windsor: {
    createSearchAd(accountId: string, params: CreateAdParams): Promise<{ isError: boolean; result: unknown }>
    pauseAd(accountId: string, params: PauseAdParams): Promise<{ isError: boolean; result: unknown }>
  } | null
  env: { writesEnabled: boolean; dryRun: boolean; adWritesEnabled: boolean; liveClients?: string[] | null }
}

type Target = { client: { id: string; slug: string }; accountId: string; campaignId: string; testId: string | null; by: { id: string } }
/** Unique per test, day and exact ad (the database refuses a second row with it). Set by the server action. */
type Key = { idempotencyKey?: string | null }
export type AdWriteOutcome = { adGroupId: string; adId: string | null; status: "dry_run" | "sent" | "failed"; logId: number | null; error?: string }
export type AdWriteResult = { ok: boolean; live: boolean; writes: AdWriteOutcome[]; error?: string }

/** The text as it will go to Google: single spaces, trimmed. */
export const tidy = (s: string) => s.replace(/\s+/g, " ").trim()

export type Proof = { line: string; where: string; problem: string; blocking: boolean }

/**
 * Checks every line before anything is sent. Blocking: Google's limits and rules (length, counts,
 * duplicates, "!" in a headline, a bad URL). Warnings: what's cost money before (a word written twice
 * like "Over Over", the same claim with different numbers like 43,000+ and 45,000+, shouting caps,
 * stray punctuation). The person still proofreads and ticks the box.
 */
export function proofread(copy: SearchAdCopy): Proof[] {
  const out: Proof[] = []
  const block = (line: string, where: string, problem: string) => out.push({ line, where, problem, blocking: true })
  const warn = (line: string, where: string, problem: string) => out.push({ line, where, problem, blocking: false })
  const headlines = copy.headlines.map(tidy).filter(Boolean)
  const descriptions = copy.descriptions.map(tidy).filter(Boolean)

  if (headlines.length < HEADLINES.min) block("", "Headlines", `Add at least ${HEADLINES.min} headlines.`)
  if (headlines.length > HEADLINES.max) block("", "Headlines", `Google allows ${HEADLINES.max} headlines at most.`)
  if (descriptions.length < DESCRIPTIONS.min) block("", "Descriptions", `Add at least ${DESCRIPTIONS.min} descriptions.`)
  if (descriptions.length > DESCRIPTIONS.max) block("", "Descriptions", `Google allows ${DESCRIPTIONS.max} descriptions at most.`)

  const lines = [...headlines.map((l, i) => ({ l, where: `Headline ${i + 1}`, max: HEADLINE_MAX, headline: true })), ...descriptions.map((l, i) => ({ l, where: `Description ${i + 1}`, max: DESCRIPTION_MAX, headline: false }))]
  for (const { l, where, max, headline } of lines) {
    if (l.length > max) block(l, where, `${l.length} characters; the limit is ${max}.`)
    if (headline && l.includes("!")) block(l, where, "Google doesn't allow \"!\" in headlines.")
    const twice = l.match(/\b(\w+)\s+\1\b/i)
    if (twice) warn(l, where, `"${twice[1]}" is written twice in a row.`)
    if (/\s[,.;:!?]/.test(l) || /([,.;:!?])\1/.test(l.replace(/\.\.\./g, ""))) warn(l, where, "Check the punctuation.")
    const shouting = l.split(" ").filter((w) => /^[A-Z]{5,}$/.test(w.replace(/[^A-Za-z]/g, "")))
    if (shouting.length) warn(l, where, `"${shouting[0]}" is in capitals; Google may refuse words in all caps that aren't acronyms.`)
  }
  const seen = new Map<string, string>()
  for (const { l, where } of lines) {
    const key = l.toLowerCase()
    if (seen.has(key)) block(l, where, `Same text as ${seen.get(key)}.`)
    else seen.set(key, where)
  }

  // The same claim with different numbers (e.g. "43,000+ Orgs" and "45,000+ organizations").
  const claims = new Map<string, Set<string>>()
  for (const { l } of lines)
    for (const m of l.matchAll(/(\d[\d,.]*)\s*(k\b|K\b)?\+?\s*([A-Za-z]+)/g)) {
      const noun = m[3].toLowerCase().replace(/s$/, "").replace(/^organization$/, "org")
      const value = m[1].replace(/,/g, "") + (m[2] ? "k" : "")
      if (noun.length < 3) continue
      claims.set(noun, (claims.get(noun) ?? new Set()).add(value))
    }
  for (const [noun, values] of claims) if (values.size > 1) warn("", "Numbers", `Different numbers for "${noun}": ${[...values].join(", ")}. Check which is right.`)

  const url = copy.finalUrl.trim()
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(url)) block(url, "Final URL", "Use a full https:// link.")
  for (const [p, where] of [[copy.path1, "Path 1"], [copy.path2, "Path 2"]] as const) {
    const v = tidy(p)
    if (v.length > PATH_MAX) block(v, where, `${v.length} characters; the limit is ${PATH_MAX}.`)
    if (/[\s/]/.test(v)) block(v, where, "No spaces or slashes in a display path.")
  }
  if (tidy(copy.path2) && !tidy(copy.path1)) block(tidy(copy.path2), "Path 2", "Path 2 needs Path 1.")
  return out
}

/** Exactly what goes to Windsor. Always paused: the team enables it in Google Ads after pinning and setting up the experiment. */
export function createParams(adGroupId: string, copy: SearchAdCopy): CreateAdParams {
  return {
    ad_group_id: adGroupId,
    headlines: copy.headlines.map(tidy).filter(Boolean),
    descriptions: copy.descriptions.map(tidy).filter(Boolean),
    final_url: copy.finalUrl.trim(),
    path1: tidy(copy.path1) || null,
    path2: tidy(copy.path2) || null,
    status: "paused",
  }
}

const isAccount = (v: string) => /^\d{3}-?\d{3}-?\d{4}$/.test(v)
const isId = (v: string) => /^\d{1,20}$/.test(v)

function isLive(deps: AdWriteDeps, slug: string) {
  const clientAllowed = !deps.env.liveClients || deps.env.liveClients.includes(slug.toLowerCase())
  const live = deps.env.writesEnabled && !deps.env.dryRun && deps.env.adWritesEnabled && clientAllowed && deps.windsor !== null
  const note = !clientAllowed
    ? "WINDSOR_LIVE_CLIENTS: live writes are off for this client, nothing was sent to Google Ads"
    : "WINDSOR_WRITES_ENABLED/WINDSOR_DRY_RUN/WINDSOR_AD_WRITES_ENABLED: nothing was sent to Google Ads"
  return { live, note }
}

/** Log first, send only when live, then log the result. One log row per write. */
async function write(
  deps: AdWriteDeps,
  t: Target,
  w: { operation: "create_responsive_search_ad" | "pause_ad"; adGroupId: string; adId: string | null; params: CreateAdParams | PauseAdParams; idempotencyKey?: string | null },
  live: boolean,
  note: string,
  send: () => Promise<{ isError: boolean; result: unknown }>,
): Promise<AdWriteOutcome> {
  const { data: log, error: logError } = await deps.db
    .from("platform_write_log")
    .insert({
      profile_id: t.by.id,
      client_id: t.client.id,
      platform: "google_ads",
      external_account_id: t.accountId,
      campaign_id: t.campaignId,
      ad_group_id: w.adGroupId,
      ad_id: w.adId,
      sprint_test_id: t.testId,
      operation: w.operation,
      payload: { connector: "google_ads", action: w.operation, account: t.accountId, params: w.params },
      dry_run: !live,
      idempotency_key: w.idempotencyKey ?? null,
    })
    .select("id")
    .single()
  if (logError?.code === "23505") return { adGroupId: w.adGroupId, adId: w.adId, status: "failed", logId: null, error: "This exact ad was already created for this test today." }
  if (logError || !log) return { adGroupId: w.adGroupId, adId: w.adId, status: "failed", logId: null, error: "Couldn't write the log, so nothing was sent to Google Ads." }
  const logId = log.id as number
  const finish = (values: object) => deps.db.from("platform_write_log").update({ ...values, completed_at: new Date().toISOString() }).eq("id", logId)

  if (!live) {
    await finish({ success: true, response: { dry_run: true, note } })
    return { adGroupId: w.adGroupId, adId: w.adId, status: "dry_run", logId }
  }
  try {
    const r = await send()
    const createdId = w.operation === "create_responsive_search_ad" && !r.isError ? createdAdId(r.result) : null
    // Only a clear refusal from Windsor frees the key, so the same ad can be tried again.
    await finish({ success: !r.isError, response: r.result ?? null, ...(createdId ? { ad_id: createdId } : {}), ...(r.isError ? { idempotency_key: null } : {}) })
    return r.isError
      ? { adGroupId: w.adGroupId, adId: w.adId, status: "failed", logId, error: resultText(r.result) || "Windsor refused it." }
      : { adGroupId: w.adGroupId, adId: createdId ?? w.adId, status: "sent", logId }
  } catch (e) {
    const message = (e as Error).message
    // A timeout or dropped connection may still have created the ad, so the key stays (Aikido):
    // check Google Ads before making it again.
    await finish({ success: false, response: { error: message } })
    return { adGroupId: w.adGroupId, adId: w.adId, status: "failed", logId, error: `${message}. Google Ads may still have created the ad: check there before trying again.` }
  }
}

/** Windsor returns the new ad as "<ad_group_id>~<ad_id>". */
export function createdAdId(result: unknown): string | null {
  const text = resultText(result) || JSON.stringify(result ?? "")
  return text.match(/\d+~(\d+)/)?.[1] ?? null
}

export async function createSearchAd(deps: AdWriteDeps, input: Target & Key & { adGroupId: string; copy: SearchAdCopy }): Promise<AdWriteResult> {
  if (!isAccount(input.accountId) || !isId(input.campaignId) || !isId(input.adGroupId)) return { ok: false, live: false, writes: [], error: "That isn't a Google Ads ad group." }
  const problems = proofread(input.copy).filter((p) => p.blocking)
  if (problems.length) return { ok: false, live: false, writes: [], error: `${problems[0].where}: ${problems[0].problem}` }
  const { live, note } = isLive(deps, input.client.slug)
  const params = createParams(input.adGroupId, input.copy)
  const out = await write(deps, input, { operation: "create_responsive_search_ad", adGroupId: input.adGroupId, adId: null, params, idempotencyKey: input.idempotencyKey }, live, note, () => deps.windsor!.createSearchAd(input.accountId, params))
  return { ok: out.status !== "failed", live, writes: [out] }
}

export const MAX_PAUSE = 20

export async function pauseAds(deps: AdWriteDeps, input: Target & { ads: { adGroupId: string; adId: string }[] }): Promise<AdWriteResult> {
  if (!isAccount(input.accountId) || !isId(input.campaignId)) return { ok: false, live: false, writes: [], error: "That isn't a Google Ads campaign." }
  if (!input.ads.length) return { ok: false, live: false, writes: [], error: "Pick the ads to pause." }
  if (input.ads.length > MAX_PAUSE) return { ok: false, live: false, writes: [], error: `Pause at most ${MAX_PAUSE} ads at a time.` }
  if (input.ads.some((a) => !isId(a.adGroupId) || !isId(a.adId))) return { ok: false, live: false, writes: [], error: "One of the ads isn't a Google Ads ad." }
  const { live, note } = isLive(deps, input.client.slug)
  const unique = [...new Map(input.ads.map((a) => [`${a.adGroupId}~${a.adId}`, a])).values()]
  const writes: AdWriteOutcome[] = []
  for (const a of unique) {
    const params: PauseAdParams = { ad_group_id: a.adGroupId, ad_id: a.adId }
    writes.push(await write(deps, input, { operation: "pause_ad", adGroupId: a.adGroupId, adId: a.adId, params }, live, note, () => deps.windsor!.pauseAd(input.accountId, params)))
  }
  return { ok: writes.every((w) => w.status !== "failed"), live, writes }
}
