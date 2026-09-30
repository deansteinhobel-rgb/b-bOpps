/**
 * What's become of something said on a client call (Dean, 2026-09-30). Plain module: used by the
 * server (reminders, the Brain tab) and the browser.
 *
 *   open      said, nothing seen yet
 *   due       open, and a week has gone by with no sign of it in the app or Notion: remind the team
 *   acted     the daily check found it happening (a test, a logged change, a Notion brief...)
 *   done      someone marked it done, or planned it as a sprint test
 *   dropped   someone said we're not doing it (with a reason)
 *   snoozed   someone asked to be reminded later
 */
export type CommitmentKind = "try" | "stop" | "change" | "idea" | "follow_up"
export type CommitmentState = "open" | "due" | "acted" | "done" | "dropped" | "snoozed"
export type CommitmentAction = { action: "done" | "dropped" | "snoozed" | "planned" | "reopened"; reason: string | null; snooze_until: string | null; created_at: string; sprint_test_id?: string | null; who?: string | null }

/** A week with nothing to show for it. */
export const REMIND_AFTER_DAYS = 7
/** Calls older than this are history: read for the brain, listed, but never a pop-up. */
export const REMIND_WINDOW_DAYS = 45

export const KIND_LABEL: Record<CommitmentKind, string> = { try: "Try", stop: "Turn off", change: "Change", idea: "Idea", follow_up: "Follow up" }
export const STATE_LABEL: Record<CommitmentState, string> = { open: "Waiting", due: "No sign of it", acted: "Seen happening", done: "Done", dropped: "Not doing", snoozed: "Snoozed" }

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/** The latest action wins; "reopened" clears the ones before it (and an automatic "acted"). */
export function commitmentState(c: { said_on: string; acted_at: string | null; acted_evidence?: string | null; created_at?: string; owner_side?: string }, actions: CommitmentAction[], today: string): CommitmentState {
  const latest = [...actions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (latest?.action === "done" || latest?.action === "planned") return "done"
  if (latest?.action === "dropped") return "dropped"
  if (latest?.action === "snoozed" && latest.snooze_until && latest.snooze_until > today) return "snoozed"
  const reopened = latest?.action === "reopened" ? latest.created_at : null
  if (c.acted_at && (!reopened || c.acted_at > reopened)) return "acted"
  // After a snooze runs out, or a reopen, the week starts again from then.
  const from = latest && (latest.action === "snoozed" || latest.action === "reopened") ? (latest.snooze_until ?? latest.created_at.slice(0, 10)) : c.said_on
  const age = daysBetween(from, today)
  const recent = daysBetween(c.said_on, today) <= REMIND_WINDOW_DAYS || latest?.action === "snoozed" || latest?.action === "reopened"
  return age >= (latest?.action === "snoozed" ? 0 : REMIND_AFTER_DAYS) && recent && c.owner_side !== "client" ? "due" : "open"
}

export const remindDate = (saidOn: string) => addDays(saidOn, REMIND_AFTER_DAYS)
