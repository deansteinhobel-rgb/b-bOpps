/**
 * THE ONLY PLACE THE APP WRITES TO AN AD PLATFORM (Dean, 2026-09-30).
 *
 * It only ever ADDS negative keywords to a Google Ads campaign or ad group, through Windsor's
 * `push_negative_keywords` action (Windsor MCP `execute_action`). Nothing is removed, paused or
 * edited, and no other action exists here (the transport in `mcp.ts` refuses any other action).
 *
 * Every push: 1) logs to platform_write_log first, 2) calls Windsor only if BOTH
 * WINDSOR_WRITES_ENABLED=true and WINDSOR_DRY_RUN=false (and, while WINDSOR_LIVE_CLIENTS is set,
 * only for those clients), 3) updates the log with the result. If the log can't be written, Windsor
 * is never called. Ad group level sends one push per ad group, each its own log row.
 */

export const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const
export type MatchType = (typeof MATCH_TYPES)[number]
export type NegativeLevel = "ad_group" | "campaign"

/** Defaults on the push form (Dean, 2026-09-30): the ad group the term came from, exact match. */
export const NEGATIVE_DEFAULTS = { level: "ad_group" as NegativeLevel, matchType: "EXACT" as MatchType }

/** Windsor's (and Google's) limits per push. */
const MAX_PER_PUSH = 500
const MAX_CHARS = 80
const MAX_WORDS = 10

export type NegativeInput = {
  client: { id: string; slug: string }
  /** The Google Ads customer ID, as Windsor lists it (e.g. "304-054-6900"). */
  accountId: string
  campaignId: string
  level: NegativeLevel
  matchType: MatchType
  /** Each term with the ad group it came from (needed for ad group level). */
  terms: { text: string; adGroupId: string }[]
  by: { id: string }
}

export type PushParams = { level: NegativeLevel; campaign_id?: string; ad_group_id?: string; keywords: { text: string; match_type: MatchType }[] }

/** Only what the push needs from Supabase (the admin client in production, a fake in tests). */
export type PushDb = {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert(row: object): { select(cols: string): { single(): PromiseLike<{ data: any; error: { message: string } | null }> } }
    update(values: object): { eq(col: string, val: unknown): PromiseLike<{ error: { message: string } | null }> }
  }
}

export type PushDeps = {
  db: PushDb
  /** Only created when writes are live. It can only ever run push_negative_keywords. */
  windsor: { pushNegativeKeywords(accountId: string, params: PushParams): Promise<{ isError: boolean; result: unknown }> } | null
  env: { writesEnabled: boolean; dryRun: boolean; liveClients?: string[] | null }
}

export type PushOutcome = { adGroupId: string | null; count: number; status: "dry_run" | "sent" | "failed"; logId: number | null; error?: string; result?: unknown }
export type PushResult = { ok: boolean; live: boolean; pushes: PushOutcome[]; error?: string }

/** Google's own rule for the text; also stops anything odd reaching the platform. */
export function cleanTerm(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase()
}

export function validateNegatives(input: NegativeInput): string | null {
  if (!/^\d{3}-?\d{3}-?\d{4}$/.test(input.accountId)) return "That isn't a Google Ads account."
  if (!/^\d{1,20}$/.test(input.campaignId)) return "That isn't a Google Ads campaign."
  if (input.level !== "ad_group" && input.level !== "campaign") return "Pick the ad group or the campaign."
  if (!MATCH_TYPES.includes(input.matchType)) return "Pick a match type."
  if (input.terms.length === 0) return "Pick at least one search term."
  if (input.terms.length > 2000) return "Push at most 2,000 terms at a time."
  for (const t of input.terms) {
    const text = cleanTerm(t.text)
    if (!text) return "One of the terms is empty."
    if (text.length > MAX_CHARS) return `"${text.slice(0, 40)}…" is over ${MAX_CHARS} characters, which Google doesn't allow for a keyword.`
    if (text.split(" ").length > MAX_WORDS) return `"${text.slice(0, 40)}…" is over ${MAX_WORDS} words, which Google doesn't allow for a keyword.`
    if (input.level === "ad_group" && !/^\d{1,20}$/.test(t.adGroupId)) return `We don't know the ad group for "${text}". Add it at campaign level instead.`
  }
  return null
}

/** The exact pushes we would send: one per ad group (ad group level) or one for the campaign, 500 terms at most each, duplicates dropped. */
export function buildPushes(input: Pick<NegativeInput, "campaignId" | "level" | "matchType" | "terms">): PushParams[] {
  const groups = new Map<string, Set<string>>()
  for (const t of input.terms) {
    const key = input.level === "ad_group" ? t.adGroupId : input.campaignId
    const set = groups.get(key) ?? new Set<string>()
    set.add(cleanTerm(t.text))
    groups.set(key, set)
  }
  const out: PushParams[] = []
  for (const [id, set] of groups) {
    const words = [...set]
    for (let i = 0; i < words.length; i += MAX_PER_PUSH) {
      const keywords = words.slice(i, i + MAX_PER_PUSH).map((text) => ({ text, match_type: input.matchType }))
      out.push(input.level === "ad_group" ? { level: "ad_group", ad_group_id: id, keywords } : { level: "campaign", campaign_id: id, keywords })
    }
  }
  return out
}

export async function pushNegativeKeywords(deps: PushDeps, input: NegativeInput): Promise<PushResult> {
  const invalid = validateNegatives(input)
  if (invalid) return { ok: false, live: false, pushes: [], error: invalid }

  const clientAllowed = !deps.env.liveClients || deps.env.liveClients.includes(input.client.slug.toLowerCase())
  const live = deps.env.writesEnabled && !deps.env.dryRun && clientAllowed && deps.windsor !== null
  const note = clientAllowed ? "WINDSOR_WRITES_ENABLED/WINDSOR_DRY_RUN: nothing was sent to Google Ads" : "WINDSOR_LIVE_CLIENTS: live writes are off for this client, nothing was sent to Google Ads"

  const pushes: PushOutcome[] = []
  for (const params of buildPushes(input)) {
    const adGroupId = params.ad_group_id ?? null
    const count = params.keywords.length
    // 1. Log first. No log, no write.
    const { data: log, error: logError } = await deps.db
      .from("platform_write_log")
      .insert({
        profile_id: input.by.id,
        client_id: input.client.id,
        platform: "google_ads",
        external_account_id: input.accountId,
        campaign_id: input.campaignId,
        ad_group_id: adGroupId,
        operation: "push_negative_keywords",
        payload: { connector: "google_ads", action: "push_negative_keywords", account: input.accountId, params },
        dry_run: !live,
      })
      .select("id")
      .single()
    if (logError || !log) {
      pushes.push({ adGroupId, count, status: "failed", logId: null, error: "Couldn't write the log, so nothing was sent to Google Ads." })
      continue
    }
    const logId = log.id as number
    const finish = (values: object) => deps.db.from("platform_write_log").update({ ...values, completed_at: new Date().toISOString() }).eq("id", logId)

    // 2. Dry run: stop here. The default everywhere until Dean switches it on.
    if (!live || !deps.windsor) {
      await finish({ success: true, response: { dry_run: true, note } })
      pushes.push({ adGroupId, count, status: "dry_run", logId })
      continue
    }

    // 3. The one real write.
    try {
      const r = await deps.windsor.pushNegativeKeywords(input.accountId, params)
      await finish({ success: !r.isError, response: r.result ?? null })
      pushes.push(r.isError ? { adGroupId, count, status: "failed", logId, error: resultText(r.result) || "Windsor refused the push.", result: r.result } : { adGroupId, count, status: "sent", logId, result: r.result })
    } catch (e) {
      const message = (e as Error).message
      await finish({ success: false, response: { error: message } })
      pushes.push({ adGroupId, count, status: "failed", logId, error: message })
    }
  }
  return { ok: pushes.every((p) => p.status !== "failed"), live, pushes }
}

/** Windsor's reply as text (MCP content blocks), for error messages. */
export function resultText(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] } | null)?.content
  return (content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n")
    .slice(0, 500)
}

/** WINDSOR_LIVE_CLIENTS (comma-separated slugs): while set, only these clients get real pushes. */
export function windsorLiveClients(raw = process.env.WINDSOR_LIVE_CLIENTS): string[] | null {
  const list = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  return list.length ? list : null
}
