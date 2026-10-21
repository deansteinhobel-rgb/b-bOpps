import { editDryRunReason, type AdsApiEnv, type AdsApiPlatform } from "./gates"

/**
 * Edits to a LinkedIn campaign that already exists (Dean, 2026-10-21): pause it, change its daily
 * budget, end date or name. One edit = one platform_write_log row, written first with the value
 * before (read from LinkedIn) and the change; then sent as a partial update; then the result.
 * There is no way to enable, remove or delete here: status can only ever be set to PAUSED, and the
 * patch is built from a fixed list of fields. A plain module so the tests can use it.
 */

export type CampaignChange =
  | { kind: "pause" }
  | { kind: "update"; dailyBudget?: number; endDate?: string | null; name?: string }

export type Before = { name: string; status: string; dailyBudget: number | null; start: string | null; startMs?: number | null; end: string | null } | null

/** The partial update LinkedIn gets: `{ patch: { $set: {...} } }` (end date removal via $delete). */
export function campaignPatch(change: CampaignChange, currency: string, before: Before) {
  if (change.kind === "pause") return { patch: { $set: { status: "PAUSED" } } }
  const set: Record<string, unknown> = {}
  if (change.dailyBudget !== undefined) {
    if (!(change.dailyBudget >= 10)) throw new Error("LinkedIn's minimum daily budget is 10.")
    set.dailyBudget = { amount: String(change.dailyBudget), currencyCode: currency }
  }
  if (change.name !== undefined) {
    const name = change.name.trim()
    if (!name || name.length > 255) throw new Error("A campaign name is 1 to 255 characters.")
    set.name = name
  }
  if (change.endDate !== undefined && change.endDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.endDate)) throw new Error("Use YYYY-MM-DD for the end date.")
    // LinkedIn wants the whole run schedule; keep the start as it is (read before the edit).
    set.runSchedule = { ...(before?.startMs ? { start: before.startMs } : {}), end: Date.parse(`${change.endDate}T23:59:59Z`) }
  }
  if (!Object.keys(set).length && change.endDate !== null) throw new Error("Nothing to change.")
  return change.endDate === null && before?.end ? { patch: { $set: set, $delete: ["runSchedule.end"] } } : { patch: { $set: set } }
}

/** What changes, before → after, for the log and the confirmation. */
export function describeChange(change: CampaignChange, before: Before, money: (n: number) => string): string[] {
  if (change.kind === "pause") return [`Status: ${before?.status ?? "unknown"} → PAUSED`]
  const lines: string[] = []
  if (change.dailyBudget !== undefined) lines.push(`Daily budget: ${before?.dailyBudget != null ? money(before.dailyBudget) : "unknown"} → ${money(change.dailyBudget)}`)
  if (change.endDate !== undefined) lines.push(`End date: ${before?.end ?? "none"} → ${change.endDate ?? "none"}`)
  if (change.name !== undefined) lines.push(`Name: ${before?.name ?? "unknown"} → ${change.name.trim()}`)
  return lines
}

export type EditStore = {
  log(row: { profile_id: string; client_id: string; platform: AdsApiPlatform; external_account_id: string; campaign_id: string; operation: "pause_campaign" | "update_campaign"; payload: Record<string, unknown>; previous: unknown; dry_run: boolean }): Promise<{ id: number } | { error: string }>
  finishLog(id: number, values: { success: boolean; response: unknown }): Promise<void>
}
export type EditSender = { patch(accountId: string, campaignId: string, body: Record<string, unknown>): Promise<unknown> }

export type EditResult = { ok: boolean; live: boolean; lines: string[]; error?: string; logId?: number }

export async function runEdit(
  deps: { store: EditStore; sender: EditSender | null; env: AdsApiEnv & { editsEnabled?: boolean } },
  o: { by: string; client: { id: string; slug: string }; accountId: string; campaignId: string; currency: string; change: CampaignChange; before: Before; money: (n: number) => string },
): Promise<EditResult> {
  if (o.change.kind === "pause" && o.before?.status === "PAUSED") return { ok: false, live: false, lines: [], error: "This campaign is already paused." }
  let body: Record<string, unknown>
  try {
    body = campaignPatch(o.change, o.currency, o.before)
  } catch (e) {
    return { ok: false, live: false, lines: [], error: (e as Error).message }
  }
  const reason = editDryRunReason(deps.env, "linkedin", o.client.slug)
  const live = reason === null && deps.sender !== null
  const lines = describeChange(o.change, o.before, o.money)
  const logged = await deps.store.log({
    profile_id: o.by,
    client_id: o.client.id,
    platform: "linkedin",
    external_account_id: o.accountId,
    campaign_id: o.campaignId,
    operation: o.change.kind === "pause" ? "pause_campaign" : "update_campaign",
    payload: body,
    previous: o.before,
    dry_run: !live,
  })
  if ("error" in logged) return { ok: false, live, lines, error: "Couldn't write the log, so nothing was sent." }
  if (!live || !deps.sender) {
    await deps.store.finishLog(logged.id, { success: true, response: { dry_run: true, note: reason ?? "No sender: nothing was sent" } })
    return { ok: true, live: false, lines, logId: logged.id }
  }
  try {
    const response = await deps.sender.patch(o.accountId, o.campaignId, body)
    await deps.store.finishLog(logged.id, { success: true, response: response ?? { status: 204 } })
    return { ok: true, live: true, lines, logId: logged.id }
  } catch (e) {
    const message = (e as Error).message
    await deps.store.finishLog(logged.id, { success: false, response: { error: message } })
    return { ok: false, live: true, lines, error: `${message}. Check LinkedIn Campaign Manager: the change may or may not have gone through.`, logId: logged.id }
  }
}
