import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { londonToday } from "@/lib/checks/periods"
import { commitmentState, daysBetween, REMIND_WINDOW_DAYS, type CommitmentAction, type CommitmentKind, type CommitmentState } from "./state"

/** One follow-up as the Brain tab and the pop-up show it. */
export type FollowUp = {
  id: string
  clientId: string
  callId: string
  callTitle: string
  kind: CommitmentKind
  title: string
  detail: string | null
  quote: string | null
  platform: string | null
  ownerSide: "bb" | "client" | "both"
  ownerName: string | null
  dueOn: string | null
  saidOn: string
  daysAgo: number
  state: CommitmentState
  evidence: string | null
  evidenceHref: string | null
  /** The latest thing someone did about it: "Dean · not doing: budget moved to Q1". */
  last: { action: CommitmentAction["action"]; who: string | null; reason: string | null; at: string; snoozeUntil: string | null; testId: string | null } | null
}

const COLS = "id, client_id, call_id, kind, title, detail, quote, platform, owner_side, owner_name, due_on, said_on, acted_at, acted_evidence, acted_href, created_at, client_calls(title)"
type Row = { id: string; client_id: string; call_id: string; kind: CommitmentKind; title: string; detail: string | null; quote: string | null; platform: string | null; owner_side: "bb" | "client" | "both"; owner_name: string | null; due_on: string | null; said_on: string; acted_at: string | null; acted_evidence: string | null; acted_href: string | null; created_at: string; client_calls: unknown }

async function withState(supabase: SupabaseClient, rows: Row[]): Promise<FollowUp[]> {
  if (!rows.length) return []
  const { data: actions } = await supabase
    .from("call_commitment_actions")
    .select("commitment_id, action, reason, snooze_until, sprint_test_id, created_at, profiles(full_name, email)")
    .in("commitment_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false })
  const today = londonToday()
  const by = new Map<string, (CommitmentAction & { who: string | null })[]>()
  for (const a of actions ?? []) {
    const p = a.profiles as unknown as { full_name: string | null; email: string } | null
    by.set(a.commitment_id, [...(by.get(a.commitment_id) ?? []), { ...(a as unknown as CommitmentAction), who: p ? (p.full_name ?? p.email) : null }])
  }
  return rows.map((r) => {
    const acts = by.get(r.id) ?? []
    const l = acts[0]
    return {
      id: r.id,
      clientId: r.client_id,
      callId: r.call_id,
      callTitle: (r.client_calls as { title: string } | null)?.title ?? "A call",
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      quote: r.quote,
      platform: r.platform,
      ownerSide: r.owner_side,
      ownerName: r.owner_name,
      dueOn: r.due_on,
      saidOn: r.said_on,
      daysAgo: daysBetween(r.said_on, today),
      state: commitmentState(r, acts, today),
      evidence: r.acted_evidence,
      evidenceHref: r.acted_href,
      last: l ? { action: l.action, who: l.who ?? null, reason: l.reason, at: l.created_at, snoozeUntil: l.snooze_until, testId: l.sprint_test_id ?? null } : null,
    }
  })
}

/** Every follow-up for a client, newest first (RLS). */
export async function followUpsForClient(supabase: SupabaseClient, clientId: string) {
  const { data } = await supabase.from("call_commitments").select(COLS).eq("client_id", clientId).is("superseded_at", null).order("said_on", { ascending: false }).order("created_at").limit(500)
  return withState(supabase, (data ?? []) as Row[])
}

/**
 * The pop-up: follow-ups due on the clients this person is on the team for (not every client an
 * admin can see, or it would be noise). RLS applies as well.
 */
export async function remindersFor(supabase: SupabaseClient, profileId: string) {
  const { data: team } = await supabase.from("client_team").select("client_id").eq("profile_id", profileId).is("removed_at", null)
  const ids = [...new Set((team ?? []).map((t) => t.client_id))]
  if (!ids.length) return []
  const from = new Date(Date.now() - (REMIND_WINDOW_DAYS + 60) * 86_400_000).toISOString().slice(0, 10)
  const { data } = await supabase.from("call_commitments").select(COLS).in("client_id", ids).is("superseded_at", null).is("acted_at", null).neq("owner_side", "client").gte("said_on", from).order("said_on")
  // The most recent few: a long queue of reminders stops being read. The rest are on the Brain tab.
  const items = (await withState(supabase, (data ?? []) as Row[])).filter((f) => f.state === "due").sort((a, b) => b.saidOn.localeCompare(a.saidOn)).slice(0, 8)
  if (!items.length) return []
  const { data: clients } = await supabase.from("clients").select("id, slug, name, logo_url").in("id", [...new Set(items.map((i) => i.clientId))])
  const byId = new Map((clients ?? []).map((c) => [c.id, c]))
  return items.map((i) => ({ ...i, client: byId.get(i.clientId) ?? { id: i.clientId, slug: "", name: "", logo_url: null } }))
}
export type Reminder = Awaited<ReturnType<typeof remindersFor>>[number]
