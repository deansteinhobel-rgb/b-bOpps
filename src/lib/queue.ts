import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { followUpsForClient } from "@/lib/calls/load"
import { KIND_LABEL, REMIND_WINDOW_DAYS } from "@/lib/calls/state"
import { currentPeriods } from "@/lib/checks/periods"
import { isRedNotActioned } from "@/lib/checks/runs"
import { longDate } from "@/lib/format"
import { loadFeed } from "@/lib/insights/feed"
import { isOpportunity } from "@/lib/insights/rules"
import { cachedPacing } from "@/lib/metrics/cached"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { PROP } from "@/lib/notion/config"
import { sprintOf } from "@/lib/sprints/periods"
import { stageOf, type TestStatus } from "@/lib/sprints/tests"

// The Today queue (Dean, 2026-09-30): everything to act on, from every source, in one ranked list.
// It only reads what the app already has (insights, checks, call follow-ups, sprint tests, pacing) and
// writes nothing; Done and Snooze go through each source's own action and log.

export type QueueClient = { id: string; slug: string; name: string; logo_url: string | null }
export type QueueSource = "insight" | "check" | "call" | "test" | "pacing"
/** attention: act now · opportunity: worth doing · week: this week's routine · later: when there's time. */
export type QueueGroup = "attention" | "opportunity" | "week" | "later"

export type QueueItem = {
  key: string
  source: QueueSource
  group: QueueGroup
  tone: "red" | "amber" | "lime" | "na"
  client: QueueClient
  platform: Platform | "ga4" | null
  title: string
  detail: string | null
  /** Short context under the title: "Optimise now · Search terms", "Weekly checks". */
  meta: string
  /** A due or age chip: "Due Sun 4 Oct", "3d overdue", "said 9 days ago". */
  when: { text: string; tone: "red" | "amber" | "na" } | null
  href: string
  /** Done / Snooze in the list, through the source's own action. Null = open it to act. */
  act: { kind: "insight"; slug: string; key: string } | { kind: "call"; id: string } | null
  /** Hide for today (browser only): for things with no log of their own, like pacing. */
  hideForToday?: boolean
  sort: number
}

/** How many insights a client puts in the queue, besides Claude's "start here" picks. */
const INSIGHTS_PER_CLIENT = 4
const OPPORTUNITIES_PER_CLIENT = 3
const CALLS_PER_CLIENT = 5

export const SOURCE_LABEL: Record<QueueSource, string> = { insight: "Optimise now", check: "Checks", call: "From a call", test: "Sprint", pacing: "Pacing" }

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
const dueWhen = (due: string, today: string): QueueItem["when"] => {
  const d = dayDiff(today, due)
  if (d < 0) return { text: `${-d}d overdue`, tone: "red" }
  if (d === 0) return { text: "Due today", tone: "amber" }
  if (d <= 2) return { text: `Due in ${d}d`, tone: "amber" }
  return { text: `Due ${longDate(due)}`, tone: "na" }
}

/**
 * The queue for the given clients. SECURITY: `clients` must have been loaded with the user's own RLS
 * client (loadFeed and cachedPacing read with the admin client once access is confirmed).
 */
export async function loadQueue(supabase: SupabaseClient, clients: QueueClient[], opts: { profileId: string }): Promise<QueueItem[]> {
  const { today, weekly, monthly } = currentPeriods()
  const sprint = sprintOf(today)
  const perClient = await Promise.all(clients.map((c) => clientQueue(supabase, c, { ...opts, today, weekly, monthly, sprintStart: sprint.start })))
  return perClient.flat().sort((a, b) => a.sort - b.sort)
}

async function clientQueue(
  supabase: SupabaseClient,
  client: QueueClient,
  o: { profileId: string; today: string; weekly: { start: string; end: string }; monthly: { start: string; end: string }; sprintStart: string },
): Promise<QueueItem[]> {
  const now = Date.now()
  const [feed, pacing, followUps, { data: runs }, { data: reds }, { data: flagged }, { data: tests }] = await Promise.all([
    loadFeed(supabase, client.id).catch(() => null),
    cachedPacing(client.id).catch(() => null),
    followUpsForClient(supabase, client.id).catch(() => []),
    supabase.from("check_runs").select("id, cadence, period_start, period_end, check_results(status)").eq("client_id", client.id).in("period_start", [o.weekly.start, o.monthly.start]),
    supabase.from("check_results").select("id, status, checked_at, notion_action_page_id, check_definitions(name)").eq("client_id", client.id).eq("status", "red").is("notion_action_page_id", null),
    supabase.from("check_results").select("id, status, flagged_at, notion_action_page_id, check_definitions(name), check_runs!inner(period_start)").eq("client_id", client.id).eq("flagged_to_profile_id", o.profileId).is("notion_action_page_id", null).in("check_runs.period_start", [o.weekly.start, o.monthly.start]).or("status.is.null,status.in.(red,amber)"),
    supabase.from("sprint_tests").select("id, title, platform, status, outcome, deadline, live_on, campaign_ids, notion_page_id, sprints!inner(start_date)").eq("client_id", client.id).eq("sprints.start_date", o.sprintStart),
  ])
  const base = `/clients/${client.slug}`
  const items: QueueItem[] = []
  const push = (i: Omit<QueueItem, "client">) => items.push({ ...i, client })

  // 1. Optimise now: open insights (not snoozed, not in hand), in Claude's order where there is one.
  // Only the top few per client (Claude's "start here" first), or the list stops being read: the
  // rest are one row pointing to Optimise now.
  const open = (feed?.insights ?? []).filter((i) => i.state === "open").sort((a, b) => (a.claude?.rank ?? 1e3) - (b.claude?.rank ?? 1e3) || (b.atStake ?? 0) - (a.atStake ?? 0))
  const startHere = new Set((feed?.review?.startHere ?? []).map((x) => x.key))
  const fixes = open.filter((i) => !isOpportunity(i))
  const opps = open.filter((i) => isOpportunity(i))
  const picked = new Set([...open.filter((i) => startHere.has(i.key)), ...fixes.slice(0, INSIGHTS_PER_CLIENT), ...opps.slice(0, OPPORTUNITIES_PER_CLIENT)].map((i) => i.key))
  for (const i of open) {
    if (!picked.has(i.key)) continue
    const opp = isOpportunity(i)
    const group: QueueGroup = opp ? "opportunity" : i.severity === "high" || startHere.has(i.key) ? "attention" : i.severity === "medium" ? "week" : "later"
    push({
      key: `insight:${i.key}`,
      source: "insight",
      group,
      tone: opp ? "lime" : i.severity === "high" ? "red" : i.severity === "medium" ? "amber" : "na",
      platform: i.platform,
      title: i.title,
      detail: i.claude?.whyNow || i.todo,
      meta: [SOURCE_LABEL.insight, startHere.has(i.key) ? "Claude: start here" : null, i.campaignName, i.listed && i.open.length ? `${i.open.length} to handle` : null].filter(Boolean).join(" · "),
      when: null,
      href: `${base}/insights?i=${encodeURIComponent(i.key)}`,
      act: { kind: "insight", slug: client.slug, key: i.key },
      sort: (i.claude ? i.claude.rank : 100) * 1e6 - Math.min(i.atStake ?? 0, 999_999),
    })
  }
  const more = open.length - picked.size
  if (more > 0) {
    push({
      key: `insight:more:${client.slug}`,
      source: "insight",
      group: "later",
      tone: "na",
      platform: null,
      title: `${more} more in Optimise now`,
      detail: "Lower in Claude's order or the rules' priority. Open Optimise now for the full list.",
      meta: SOURCE_LABEL.insight,
      when: null,
      href: `${base}/insights`,
      act: null,
      sort: 9e9,
    })
  }

  // 2. Checks: reds with no Notion action after 24 hours, anything flagged to you, and what's left this week and month.
  const redIds = new Set<string>()
  for (const r of reds ?? []) {
    if (!isRedNotActioned(r as never, now)) continue
    redIds.add(r.id)
    push({
      key: `check:red:${r.id}`,
      source: "check",
      group: "attention",
      tone: "red",
      platform: null,
      title: `Red check with no action: ${(r.check_definitions as unknown as { name: string } | null)?.name ?? "a check"}`,
      detail: "Brief the team from the check, so the fix is tracked in Notion.",
      meta: SOURCE_LABEL.check,
      when: r.checked_at ? { text: `${dayDiff(r.checked_at.slice(0, 10), o.today)}d ago`, tone: "red" } : null,
      href: `${base}/checks?result=${r.id}`,
      act: null,
      sort: 1,
    })
  }
  // Flagged to you this week or month, and not green (a green flag is for information).
  for (const f of flagged ?? []) {
    if (redIds.has(f.id)) continue
    push({
      key: `check:flag:${f.id}`,
      source: "check",
      group: "attention",
      tone: f.status === "red" ? "red" : "amber",
      platform: null,
      title: `Flagged to you: ${(f.check_definitions as unknown as { name: string } | null)?.name ?? "a check"}`,
      detail: null,
      meta: SOURCE_LABEL.check,
      when: f.flagged_at ? { text: `${dayDiff(f.flagged_at.slice(0, 10), o.today)}d ago`, tone: "amber" } : null,
      href: `${base}/checks?result=${f.id}`,
      act: null,
      sort: 2,
    })
  }
  for (const cadence of ["weekly", "monthly"] as const) {
    const period = cadence === "weekly" ? o.weekly : o.monthly
    const run = (runs ?? []).find((r) => r.cadence === cadence && r.period_start === period.start)
    const results = (run?.check_results ?? []) as { status: string | null }[]
    const left = run ? results.filter((r) => r.status === null).length : null
    if (left === 0) continue
    const when = dueWhen(period.end, o.today)
    push({
      key: `check:${cadence}`,
      source: "check",
      group: when?.tone === "na" && cadence === "monthly" ? "later" : "week",
      tone: when?.tone === "red" ? "red" : when?.tone === "amber" ? "amber" : "na",
      platform: null,
      title: left === null ? `${cadence === "weekly" ? "This week's" : "This month's"} checks aren't started` : `${left} of ${results.length} ${cadence} checks to do`,
      detail: null,
      meta: SOURCE_LABEL.check,
      when,
      href: `${base}/checks`,
      act: null,
      sort: 3e6 + dayDiff(o.today, period.end),
    })
  }

  // 3. Call follow-ups: B&B's items a week after the call with no sign of them (the pop-up's rule).
  // The newest few per client, like the pop-up; the rest are one row pointing to the Brain tab.
  const due = followUps.filter((f) => f.state === "due" && f.ownerSide !== "client" && f.daysAgo <= REMIND_WINDOW_DAYS).sort((a, b) => a.daysAgo - b.daysAgo)
  for (const f of due.slice(0, CALLS_PER_CLIENT)) {
    push({
      key: `call:${f.id}`,
      source: "call",
      group: "attention",
      tone: "amber",
      platform: f.platform && f.platform in PLATFORM_LABEL ? (f.platform as Platform) : null,
      title: f.title,
      detail: `${KIND_LABEL[f.kind]}, said on "${f.callTitle}". No sign of it since.`,
      meta: [SOURCE_LABEL.call, f.ownerName].filter(Boolean).join(" · "),
      when: { text: `said ${f.daysAgo}d ago`, tone: "amber" },
      href: `${base}/brain#calls`,
      act: { kind: "call", id: f.id },
      sort: 5e5 + f.daysAgo,
    })
  }
  if (due.length > CALLS_PER_CLIENT) {
    push({
      key: `call:more:${client.slug}`,
      source: "call",
      group: "later",
      tone: "na",
      platform: null,
      title: `${due.length - CALLS_PER_CLIENT} more follow-ups from calls`,
      detail: "Older things said on calls with no sign of them yet. They're all on the Brain tab.",
      meta: SOURCE_LABEL.call,
      when: null,
      href: `${base}/brain#calls`,
      act: null,
      sort: 9e9,
    })
  }

  // 4. This sprint's tests: the next step for each one that's waiting on us.
  const pageIds = (tests ?? []).map((t) => t.notion_page_id).filter(Boolean) as string[]
  const { data: pages } = pageIds.length ? await supabase.from("notion_pages_mirror").select("notion_page_id, properties").in("notion_page_id", pageIds) : { data: [] }
  const briefOf = new Map((pages ?? []).map((p) => [p.notion_page_id, p.properties as Record<string, unknown>]))
  for (const t of tests ?? []) {
    const props = t.notion_page_id ? briefOf.get(t.notion_page_id) : undefined
    const stage = stageOf({ status: t.status as TestStatus, outcome: t.outcome }, props ? { master: (props[PROP.status] as string) ?? null, paid: (props[PROP.statusPaid] as string) ?? null } : null)
    const due = t.deadline ? dueWhen(t.deadline, o.today) : null
    const step =
      stage === "planned" ? { title: `Brief the team: ${t.title}`, detail: "Planned, not briefed yet." }
      : stage === "ready" ? { title: `Build and launch: ${t.title}`, detail: "The brief is ready for build. Set it live in the platform, then mark it live with its campaigns." }
      : stage === "live" && !(t.campaign_ids ?? []).length ? { title: `Pick the campaigns for: ${t.title}`, detail: "It's live, but the app doesn't know which campaigns to measure." }
      : stage === "review" ? { title: `Call the result: ${t.title}`, detail: "Write what worked and call it proven, disproven or inconclusive." }
      : null
    if (!step) continue
    const late = due?.tone === "red"
    push({
      key: `test:${t.id}:${stage}`,
      source: "test",
      group: late || stage === "ready" ? "attention" : "week",
      tone: late ? "red" : stage === "ready" || due?.tone === "amber" ? "amber" : "na",
      platform: (t.platform as Platform | null) ?? null,
      title: step.title,
      detail: step.detail,
      meta: SOURCE_LABEL.test,
      when: stage === "planned" || stage === "ready" ? due : null,
      href: `${base}/sprint#test-${t.id}`,
      act: null,
      sort: late ? 3 : 2e6 + (t.deadline ? dayDiff(o.today, t.deadline) : 99),
    })
  }

  // 5. Pacing: a platform well off where its spend should be today.
  for (const p of pacing?.pacing ?? []) {
    if (p.status !== "red") continue
    const over = (p.variancePct ?? 0) > 0
    push({
      key: `pacing:${p.platform}:${p.month}`,
      source: "pacing",
      group: "attention",
      tone: "red",
      platform: p.platform,
      title: `${PLATFORM_LABEL[p.platform]} ${over ? "over" : "under"} pace: ${Math.round((p.ratio ?? 0) * 100)}% of where spend should be today`,
      detail: over ? "Check budgets and bids, or confirm the overspend is planned." : "Check for paused campaigns, limited budgets or disapproved ads.",
      meta: SOURCE_LABEL.pacing,
      when: null,
      href: `${base}/reporting#overview`,
      act: null,
      hideForToday: true,
      sort: 4,
    })
  }
  return items
}
