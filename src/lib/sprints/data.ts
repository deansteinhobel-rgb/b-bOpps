import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { unstable_cache } from "next/cache"
import { addDays, rankAds, totals, type AdStat, type DailyRow, type Totals } from "@/lib/metrics/ads"
import { windsorTag } from "@/lib/metrics/cached"
import type { Platform } from "@/lib/metrics/types"
import { createAdminClient } from "@/lib/supabase/admin"
import type { AdEvent } from "./detect"
import { sprintByNumber, type SprintPeriod } from "./periods"

export type ItemKind = "hypothesis" | "learning" | "mitigation" | "action" | "carried"
export type Sprint = {
  id: string
  client_id: string
  number: number
  start_date: string
  end_date: string
  goal: string | null
  key_takeaway: string | null
  highlights: string | null
  challenges: string | null
  progress_made: string | null
  summary: SprintSummary | null
  closed_at: string | null
}
export type SprintItem = {
  id: string
  sprint_id: string
  kind: ItemKind
  text: string
  status: "open" | "done" | "dropped"
  outcome: "proven" | "disproven" | "inconclusive" | null
  carry_forward: boolean
  carried_from_item_id: string | null
  origin_kind: ItemKind | null
  origin_sprint_number: number | null
  check_result_id: string | null
  notion_page_id: string | null
  created_at: string
}
export type SprintChange = {
  id: string
  changed_on: string
  platform: Platform | null
  campaign_name: string | null
  type: string
  description: string
  hypothesis_item_id: string | null
  source: "manual" | "detected"
  detected_key: string | null
  status: "logged" | "dismissed"
  created_at: string
  profiles: { full_name: string | null; email: string } | null
}

const SPRINT_COLS = "id, client_id, number, start_date, end_date, goal, key_takeaway, highlights, challenges, progress_made, summary, closed_at"

/**
 * The sprint for a period, created on first view (as the signed-in user; RLS allows the client's
 * team). A new sprint pulls in the items the previous sprint chose to carry forward.
 */
export async function ensureSprint(supabase: SupabaseClient, clientId: string, period: SprintPeriod): Promise<Sprint> {
  const find = async () => {
    const { data, error } = await supabase.from("sprints").select(SPRINT_COLS).eq("client_id", clientId).eq("start_date", period.start).maybeSingle()
    if (error) console.error("sprint lookup failed", error)
    return data as Sprint | null
  }
  let sprint = await find()
  if (!sprint) {
    const { error: insertError } = await supabase
      .from("sprints")
      .upsert({ client_id: clientId, number: period.number, start_date: period.start, end_date: period.end }, { onConflict: "client_id,start_date", ignoreDuplicates: true })
    if (insertError) console.error("sprint create failed", insertError)
    // Two page loads can create it at the same moment; give the other one a beat.
    for (let attempt = 0; !sprint && attempt < 3; attempt++) {
      sprint = await find()
      if (!sprint) await new Promise((r) => setTimeout(r, 200))
    }
    if (!sprint) throw new Error(`Could not create the sprint${insertError ? `: ${insertError.message}` : ""}`)
    const prev = sprintByNumber(period.number - 1)
    const { data: previous } = await supabase.from("sprints").select("id, number").eq("client_id", clientId).eq("start_date", prev.start).maybeSingle()
    if (previous) {
      await carryForward(supabase, previous as { id: string; number: number }, sprint as Sprint)
      await carryTests(supabase, (previous as { id: string }).id, sprint as Sprint)
    }
  }
  return sprint as Sprint
}

/** Copies the chosen items of one sprint into the next. Safe to repeat: already-carried items are skipped. */
export async function carryForward(supabase: SupabaseClient, from: { id: string; number: number }, to: Pick<Sprint, "id" | "client_id">) {
  const [{ data: chosen }, { data: already }] = await Promise.all([
    supabase.from("sprint_items").select("id, kind, text, origin_kind, origin_sprint_number").eq("sprint_id", from.id).eq("carry_forward", true).neq("status", "dropped"),
    supabase.from("sprint_items").select("carried_from_item_id").eq("sprint_id", to.id).not("carried_from_item_id", "is", null),
  ])
  const done = new Set((already ?? []).map((a) => a.carried_from_item_id))
  const rows = (chosen ?? [])
    .filter((c) => !done.has(c.id))
    .map((c) => ({
      sprint_id: to.id,
      client_id: to.client_id,
      kind: "carried",
      text: c.text,
      carried_from_item_id: c.id,
      // Keep the original kind and sprint through repeated carries.
      origin_kind: c.kind === "carried" ? c.origin_kind : c.kind,
      origin_sprint_number: c.kind === "carried" ? c.origin_sprint_number : from.number,
    }))
  if (rows.length) {
    const { error } = await supabase.from("sprint_items").insert(rows)
    if (error) throw new Error(`Carrying items forward: ${error.message}`)
  }
  return rows.length
}

/**
 * Copies tests marked "carried" in one sprint into the next, keeping their progress (Notion brief,
 * live date, campaigns) so the work continues. Safe to repeat: already-carried tests are skipped.
 */
export async function carryTests(supabase: SupabaseClient, fromSprintId: string, to: Pick<Sprint, "id" | "client_id">) {
  const [{ data: carried }, { data: already }] = await Promise.all([
    supabase.from("sprint_tests").select("*").eq("sprint_id", fromSprintId).eq("outcome", "carried"),
    supabase.from("sprint_tests").select("carried_from_test_id").eq("sprint_id", to.id).not("carried_from_test_id", "is", null),
  ])
  const done = new Set((already ?? []).map((a) => a.carried_from_test_id))
  const rows = (carried ?? [])
    .filter((t) => !done.has(t.id))
    .map((t) => ({
      sprint_id: to.id,
      client_id: to.client_id,
      platform: t.platform,
      title: t.title,
      hypothesis: t.hypothesis,
      assets: t.assets,
      brief_notes: t.brief_notes,
      success_metric: t.success_metric,
      success_target: t.success_target,
      success_text: t.success_text,
      owner_notion_user_id: t.owner_notion_user_id,
      owner_name: t.owner_name,
      deadline: t.deadline,
      status: t.status === "review" ? "live" : t.status,
      notion_page_id: t.notion_page_id,
      briefed_at: t.briefed_at,
      ready_at: t.ready_at,
      live_on: t.live_on,
      campaign_ids: t.campaign_ids,
      campaign_names: t.campaign_names,
      carried_from_test_id: t.id,
      created_by_profile_id: t.created_by_profile_id,
    }))
  if (rows.length) {
    const { error } = await supabase.from("sprint_tests").insert(rows)
    if (error) throw new Error(`Carrying tests forward: ${error.message}`)
  }
  return rows.length
}

export type SprintTest = {
  id: string
  platform: Platform | null
  title: string
  hypothesis: string | null
  assets: string[]
  brief_notes: string | null
  success_metric: string | null
  success_target: number | null
  success_text: string | null
  owner_notion_user_id: string | null
  owner_name: string | null
  deadline: string | null
  status: "planned" | "briefed" | "ready" | "live" | "review" | "closed"
  notion_page_id: string | null
  live_on: string | null
  campaign_ids: string[]
  campaign_names: string[]
  findings_worked: string | null
  findings_blockers: string | null
  findings_notes: string | null
  outcome: "proven" | "disproven" | "inconclusive" | "carried" | null
  carry_reason: string | null
  carry_note: string | null
  carried_from_test_id: string | null
  created_at: string
}

export async function loadSprintDetails(supabase: SupabaseClient, sprint: Sprint) {
  const [{ data: items }, { data: changes }, { data: history }, { data: previous }, { data: tests }] = await Promise.all([
    supabase.from("sprint_items").select("*").eq("sprint_id", sprint.id).order("created_at"),
    supabase
      .from("sprint_changes")
      .select("id, changed_on, platform, campaign_name, type, description, hypothesis_item_id, source, detected_key, status, created_at, profiles(full_name, email)")
      .eq("sprint_id", sprint.id)
      .order("changed_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("sprints").select("id, number, start_date, end_date, key_takeaway, closed_at, summary").eq("client_id", sprint.client_id).order("start_date", { ascending: false }).limit(30),
    supabase.from("sprints").select("id, number, closed_at").eq("client_id", sprint.client_id).eq("start_date", sprintByNumber(sprint.number - 1).start).maybeSingle(),
    supabase.from("sprint_tests").select("*").eq("sprint_id", sprint.id).order("created_at"),
  ])
  return {
    items: (items ?? []) as SprintItem[],
    changes: (changes ?? []) as unknown as SprintChange[],
    history: (history ?? []) as Pick<Sprint, "id" | "number" | "start_date" | "end_date" | "key_takeaway" | "closed_at" | "summary">[],
    previous: previous as { id: string; number: number; closed_at: string | null } | null,
    tests: ((tests ?? []) as SprintTest[]).map((t) => ({ ...t, success_target: t.success_target === null ? null : Number(t.success_target) })),
  }
}

export type SprintSummary = {
  dataThrough: string | null
  current: Totals
  previous: Totals
  byPlatform: { platform: Platform; current: Totals; previous: Totals }[]
  best: { platform: Platform; name: string; basis: string; value: string }[]
  trend: { number: number; start: string; spend: number; results: number; costPerResult: number | null }[]
}

const n = (v: unknown) => Number(v) || 0
const PLATFORMS: Platform[] = ["linkedin", "google_ads", "meta"]

export async function computeSprintNumbers(clientId: string, period: SprintPeriod) {
  const db = createAdminClient()
  const trendFrom = sprintByNumber(period.number - 5).start
  const [{ data: ranges }, { data: dailyRaw }, { data: adRaw }, { data: eventsRaw }] = await Promise.all([
    db.from("account_data_range").select("data_through").eq("client_id", clientId),
    db.rpc("platform_daily", { p_client: clientId, p_from: trendFrom, p_to: period.end }),
    db.rpc("ad_stats", { p_client: clientId, p_from: period.start, p_to: period.end }),
    db.rpc("sprint_ad_events", { p_client: clientId, p_from: period.start, p_to: period.end }),
  ])
  const dataThrough = (ranges ?? []).map((r) => r.data_through as string).sort().at(-1) ?? null
  const daily: DailyRow[] = ((dailyRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    platform: r.platform as Platform,
    date: r.date as string,
    spend: n(r.spend),
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    conversions: n(r.conversions),
    leads: n(r.leads),
  }))
  const prev = sprintByNumber(period.number - 1)
  // Compare like with like: if the sprint is part-way through, compare the same number of days.
  const elapsedEnd = dataThrough && dataThrough < period.end ? dataThrough : period.end
  const days = Math.round((Date.parse(elapsedEnd) - Date.parse(period.start)) / 864e5)
  const prevEnd = addDays(prev.start, Math.max(days, 0))
  const ads: AdStat[] = ((adRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    platform: r.platform as Platform,
    external_account_id: r.external_account_id as string,
    ad_id: r.ad_id as string,
    ad_name: (r.ad_name as string) ?? null,
    campaign_name: (r.campaign_name as string) ?? null,
    spend: n(r.spend),
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    conversions: n(r.conversions),
    leads: n(r.leads),
  }))
  const summary: SprintSummary = {
    dataThrough,
    current: totals(daily, period.start, period.end),
    previous: totals(daily, prev.start, prevEnd),
    byPlatform: PLATFORMS.filter((p) => daily.some((d) => d.platform === p)).map((platform) => ({
      platform,
      current: totals(daily, period.start, period.end, platform),
      previous: totals(daily, prev.start, prevEnd, platform),
    })),
    best: rankAds(ads)
      .filter((r) => r.best)
      .map((r) => ({
        platform: r.platform,
        name: r.best!.ad_name ?? r.best!.ad_id,
        basis: r.basis === "cost_per_result" ? "cost per result" : "CTR",
        value: r.basis === "cost_per_result" ? String(Math.round(r.best!.costPerResult ?? 0)) : `${((r.best!.ctr ?? 0) * 100).toFixed(2)}%`,
      })),
    trend: Array.from({ length: 6 }, (_, i) => sprintByNumber(period.number - 5 + i)).map((s) => {
      const t = totals(daily, s.start, s.end)
      return { number: s.number, start: s.start, spend: t.spend, results: t.results, costPerResult: t.costPerResult }
    }),
  }
  const events: AdEvent[] = ((eventsRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    platform: r.platform as Platform,
    ad_id: r.ad_id as string,
    ad_name: (r.ad_name as string) ?? null,
    campaign_name: (r.campaign_name as string) ?? null,
    first_seen: r.first_seen as string,
    last_seen: r.last_seen as string,
    data_through: r.data_through as string,
    spend_in_range: n(r.spend_in_range),
  }))
  const detectionDaily = daily.filter((d) => d.date >= addDays(period.start, -7)).map(({ platform, date, spend }) => ({ platform, date, spend }))
  return { summary, events, detectionDaily }
}

/**
 * Sprint numbers from the Windsor cache, cached like the Overview. SECURITY: admin client; only call
 * after the sprint/client was loaded through the user's RLS client.
 */
export const cachedSprintNumbers = (clientId: string, period: SprintPeriod) =>
  unstable_cache(() => computeSprintNumbers(clientId, period), ["sprint-numbers", clientId, period.start], { tags: ["windsor", windsorTag(clientId)], revalidate: 900 })()
