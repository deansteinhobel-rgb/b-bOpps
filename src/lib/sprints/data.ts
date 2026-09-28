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
  const find = () => supabase.from("sprints").select(SPRINT_COLS).eq("client_id", clientId).eq("start_date", period.start).maybeSingle()
  let { data: sprint } = await find()
  if (!sprint) {
    await supabase
      .from("sprints")
      .upsert({ client_id: clientId, number: period.number, start_date: period.start, end_date: period.end }, { onConflict: "client_id,start_date", ignoreDuplicates: true })
    ;({ data: sprint } = await find())
    if (!sprint) throw new Error("Could not create the sprint")
    const prev = sprintByNumber(period.number - 1)
    const { data: previous } = await supabase.from("sprints").select("id, number").eq("client_id", clientId).eq("start_date", prev.start).maybeSingle()
    if (previous) await carryForward(supabase, previous as { id: string; number: number }, sprint as Sprint)
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

export async function loadSprintDetails(supabase: SupabaseClient, sprint: Sprint) {
  const [{ data: items }, { data: changes }, { data: history }, { data: previous }] = await Promise.all([
    supabase.from("sprint_items").select("*").eq("sprint_id", sprint.id).order("created_at"),
    supabase
      .from("sprint_changes")
      .select("id, changed_on, platform, campaign_name, type, description, hypothesis_item_id, source, detected_key, status, created_at, profiles(full_name, email)")
      .eq("sprint_id", sprint.id)
      .order("changed_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("sprints").select("id, number, start_date, end_date, key_takeaway, closed_at, summary").eq("client_id", sprint.client_id).order("start_date", { ascending: false }).limit(30),
    supabase.from("sprints").select("id, number, closed_at").eq("client_id", sprint.client_id).eq("start_date", sprintByNumber(sprint.number - 1).start).maybeSingle(),
  ])
  return {
    items: (items ?? []) as SprintItem[],
    changes: (changes ?? []) as unknown as SprintChange[],
    history: (history ?? []) as Pick<Sprint, "id" | "number" | "start_date" | "end_date" | "key_takeaway" | "closed_at" | "summary">[],
    previous: previous as { id: string; number: number; closed_at: string | null } | null,
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
