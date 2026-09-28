import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { currentPeriods, type Cadence, type Period } from "./periods"

export type CheckDefinition = {
  id: string
  key: string
  name: string
  cadence: Cadence
  owner_role: "gtm_lead" | "am" | "specialist"
  pre_loaded: string | null
  instructions: string
  what_to_record: string | null
  not_applicable_when: string | null
  flag_immediately_when: string | null
  guide: string | null
  sort_order: number
}

export type CheckResult = {
  id: string
  check_definition_id: string
  status: "green" | "amber" | "red" | "na" | null
  findings: string | null
  flagged_to_profile_id: string | null
  flagged_at: string | null
  checked_by_profile_id: string | null
  checked_at: string | null
  notion_action_page_id: string | null
  auto_data: unknown
}

/** Brief: a red result with no Notion action 24 hours after it was checked. */
export function isRedNotActioned(r: Pick<CheckResult, "status" | "notion_action_page_id" | "checked_at">, now: number) {
  return r.status === "red" && !r.notion_action_page_id && !!r.checked_at && now - Date.parse(r.checked_at) > 864e5
}

export type CheckRun = { id: string; cadence: Cadence; period_start: string; period_end: string; created_at: string }

/**
 * Makes sure this week's and this month's runs exist for the client, each with one (empty)
 * result per active check. Safe to call on every page view: duplicates are ignored.
 * Runs as the signed-in user, so RLS only lets team members of the client create them.
 */
export async function ensureCurrentRuns(supabase: SupabaseClient, clientId: string, now = new Date()) {
  const { weekly, monthly } = currentPeriods(now)
  const { data: defs, error: defErr } = await supabase.from("check_definitions").select("id, cadence").eq("active", true)
  if (defErr) throw new Error(defErr.message)

  const runs: Record<Cadence, CheckRun> = {} as Record<Cadence, CheckRun>
  for (const period of [weekly, monthly] as Period[]) {
    await supabase
      .from("check_runs")
      .upsert({ client_id: clientId, cadence: period.cadence, period_start: period.start, period_end: period.end }, { onConflict: "client_id,cadence,period_start", ignoreDuplicates: true })
    const { data: run, error } = await supabase
      .from("check_runs")
      .select("id, cadence, period_start, period_end, created_at")
      .eq("client_id", clientId)
      .eq("cadence", period.cadence)
      .eq("period_start", period.start)
      .single()
    if (error || !run) throw new Error(`Could not create the ${period.cadence} check run: ${error?.message}`)
    runs[period.cadence] = run as CheckRun

    const rows = (defs ?? []).filter((d) => d.cadence === period.cadence).map((d) => ({ check_run_id: run.id, client_id: clientId, check_definition_id: d.id }))
    if (rows.length) {
      const { error: resErr } = await supabase.from("check_results").upsert(rows, { onConflict: "check_run_id,check_definition_id", ignoreDuplicates: true })
      if (resErr) throw new Error(`Could not create check results: ${resErr.message}`)
    }
  }
  return runs
}

export async function loadRun(supabase: SupabaseClient, runId: string) {
  const [{ data: run }, { data: results }, { data: defs }] = await Promise.all([
    supabase.from("check_runs").select("id, cadence, period_start, period_end, created_at, client_id").eq("id", runId).single(),
    supabase
      .from("check_results")
      .select("id, check_definition_id, status, findings, flagged_to_profile_id, flagged_at, checked_by_profile_id, checked_at, notion_action_page_id, auto_data")
      .eq("check_run_id", runId),
    supabase.from("check_definitions").select("*").order("sort_order"),
  ])
  if (!run) return null
  const byDef = new Map((results ?? []).map((r) => [r.check_definition_id, r as CheckResult]))
  const now = Date.now()
  const items = ((defs ?? []) as CheckDefinition[])
    .filter((d) => byDef.has(d.id))
    .map((definition) => {
      const result = byDef.get(definition.id)!
      return { definition, result, redNotActioned: isRedNotActioned(result, now) }
    })
  const done = items.filter((i) => i.result.status !== null).length
  return { run: run as CheckRun & { client_id: string }, items, done, total: items.length }
}

/** Earlier runs for the history list, newest first, with completion and red counts. */
export async function pastRuns(supabase: SupabaseClient, clientId: string, excludeIds: string[]) {
  const { data } = await supabase
    .from("check_runs")
    .select("id, cadence, period_start, period_end, check_results(status, notion_action_page_id)")
    .eq("client_id", clientId)
    .order("period_start", { ascending: false })
    .limit(30)
  return (data ?? [])
    .filter((r) => !excludeIds.includes(r.id))
    .map((r) => {
      const res = (r.check_results ?? []) as { status: string | null; notion_action_page_id: string | null }[]
      return {
        id: r.id as string,
        cadence: r.cadence as Cadence,
        period_start: r.period_start as string,
        period_end: r.period_end as string,
        done: res.filter((x) => x.status !== null).length,
        total: res.length,
        reds: res.filter((x) => x.status === "red").length,
      }
    })
}
