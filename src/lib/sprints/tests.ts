/**
 * Sprint tests: the unit of a sprint (Dean, 2026-09-28). Pure rules and labels, no database access.
 *   planned → briefed in Notion (in production) → ready (Notion "Client Approved" / "Production
 *   Complete") → live → review → outcome (proven / disproven / inconclusive / carried).
 */
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"

export const ASSETS: Record<string, string> = {
  ad_creative: "Ad creative",
  ad_copy: "Ad copy",
  landing_page: "Landing page",
  video: "Video",
  lead_form: "Lead form",
  email: "Email",
  other: "Other",
}

export const METRICS: Record<string, { label: string; lowerIsBetter: boolean; unit: "money" | "percent" | "count" }> = {
  cost_per_result: { label: "Cost per result", lowerIsBetter: true, unit: "money" },
  cpc: { label: "Cost per click", lowerIsBetter: true, unit: "money" },
  ctr: { label: "CTR", lowerIsBetter: false, unit: "percent" },
  results: { label: "Results (conversions + leads)", lowerIsBetter: false, unit: "count" },
}

export const CARRY_REASONS: Record<string, string> = {
  deadline: "Missed the deadline",
  setup_time: "Needed more time to set up",
  too_short_live: "Not live long enough to judge",
  awaiting_approval: "Waiting on approval",
  other: "Other",
}

/** Notion Master Status values that mean a briefed test is ready to launch (Dean). */
export const READY_STATUSES = ["Client Approved", "Production Complete"]

export type TestStatus = "planned" | "briefed" | "ready" | "live" | "review" | "closed"
export type Stage = "planned" | "in_production" | "ready" | "live" | "review" | "done"

export const STAGES: { key: Stage; label: string; hint: string }[] = [
  { key: "planned", label: "Planned", hint: "Brief the team" },
  { key: "in_production", label: "In production", hint: "Waiting on Notion" },
  { key: "ready", label: "Ready to launch", hint: "Make it live" },
  { key: "live", label: "Live", hint: "Watch the results" },
  { key: "review", label: "Review", hint: "Findings and outcome" },
  { key: "done", label: "Done", hint: "" },
]

/** Where a test sits on the board. A briefed test becomes ready when Notion says so. */
export function stageOf(t: { status: TestStatus; outcome: string | null }, notionStatus: string | null): Stage {
  if (t.outcome || t.status === "closed") return "done"
  if (t.status === "review") return "review"
  if (t.status === "live") return "live"
  if (t.status === "ready") return "ready"
  if (t.status === "briefed") return notionStatus && READY_STATUSES.includes(notionStatus) ? "ready" : "in_production"
  return "planned"
}

export type TestTotals = { spend: number; impressions: number; clicks: number; conversions: number; leads: number; days: number; data_through: string | null }

/** The success metric's value from a live test's campaign totals, and whether it meets the target. */
export function evaluate(metric: string | null, target: number | null, t: TestTotals) {
  const results = t.conversions + t.leads
  const values: Record<string, number | null> = {
    cost_per_result: results > 0 ? t.spend / results : null,
    cpc: t.clicks > 0 ? t.spend / t.clicks : null,
    ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null,
    results,
  }
  const value = metric ? (values[metric] ?? null) : null
  const def = metric ? METRICS[metric] : undefined
  const meets = value === null || target === null || !def ? null : def.lowerIsBetter ? value <= target : value >= target
  return { value, meets, results }
}

export function successLine(metric: string | null, target: number | null, text: string | null, money: (v: number) => string) {
  const def = metric ? METRICS[metric] : undefined
  const parts: string[] = []
  if (def && target !== null) {
    const v = def.unit === "money" ? money(target) : def.unit === "percent" ? `${target}%` : String(target)
    parts.push(`${def.label} ${def.lowerIsBetter ? "at or below" : "at or above"} ${v}`)
  }
  if (text) parts.push(text)
  return parts.join(". ") || "Not set"
}

/**
 * The first comment on the Notion brief, written like the team briefs each other (Dean,
 * 2026-09-30): what we're testing and why, what we need from copy and design (from the pop-up's
 * "What we need" step, `needsText`), success, deadline. A draft the person briefing can edit.
 * Tagged people are greeted at the top.
 */
export function briefComment(opts: {
  sprintNumber: number
  platformLabel: string
  title: string
  hypothesis: string | null
  notes: string | null
  needs: string | null
  success: string
  deadline: string | null
  appUrl: string
}) {
  const parts = [
    `For Sprint ${opts.sprintNumber} we're testing ${opts.title} on ${opts.platformLabel}.`,
    opts.hypothesis ? `Why: ${opts.hypothesis}` : null,
    opts.notes ? opts.notes : null,
    opts.needs,
    `Success looks like: ${opts.success}`,
    opts.deadline ? `We need it by ${opts.deadline}.` : null,
    `The full plan is in Lumaux: ${opts.appUrl}`,
  ]
  return parts.filter(Boolean).join("\n\n")
}

/** The Notion brief's description: everything the production team needs in one place. */
export function briefText(opts: {
  sprintNumber: number
  sprintDates: string
  platform: Platform | null
  title: string
  hypothesis: string | null
  assets: string[]
  notes: string | null
  success: string
  deadline: string | null
  owner: string | null
  appUrl: string
  /** "What we need" from the brief pop-up. */
  needs?: string | null
}) {
  const lines = [
    `Paid media test · Sprint ${opts.sprintNumber} (${opts.sprintDates})`,
    `What we're testing: ${opts.title}`,
    opts.hypothesis ? `Hypothesis: ${opts.hypothesis}` : null,
    `Platform: ${opts.platform ? PLATFORM_LABEL[opts.platform] : "Several platforms"}`,
    `Assets needed: ${opts.assets.length ? opts.assets.map((a) => ASSETS[a] ?? a).join(", ") : "None listed"}`,
    opts.notes ? `Brief: ${opts.notes}` : null,
    opts.needs ? opts.needs : null,
    `Success looks like: ${opts.success}`,
    `Deadline: ${opts.deadline ?? "Not set"}${opts.owner ? ` · Owner: ${opts.owner}` : ""}`,
    `Set "Master Status" to Client Approved or Production Complete when it's ready to launch.`,
    `Test in Lumaux: ${opts.appUrl}`,
  ]
  return lines.filter(Boolean).join("\n")
}
