/**
 * Admin → Activity (Dean, 2026-10-21): every change people make, in one list. Four sources:
 *   app       edits in Lumaux (`change_log`, written by triggers)
 *   platform  writes Lumaux sent to an ad platform (`platform_write_log`), dry runs included
 *   notion    pages and comments Lumaux created in Notion (`notion_write_log`)
 *   outside   changes made inside the ad platforms themselves (`platform_changes`)
 * Plain module (no server imports): the wording rules live here and are tested.
 */
export type ActivitySource = "app" | "platform" | "notion" | "outside"

export const SOURCE_LABEL: Record<ActivitySource, string> = {
  app: "In Lumaux",
  platform: "Lumaux → platform",
  notion: "Lumaux → Notion",
  outside: "In the platform",
}

export type ActivityItem = {
  id: string
  at: string
  source: ActivitySource
  clientId: string | null
  /** A Lumaux person, when we know who. */
  profileId: string | null
  /** A name from the platform's own log, for changes made outside Lumaux. */
  actorName: string | null
  platform: string | null
  title: string
  /** Changed fields, "status: planned → briefed". */
  details: string[]
  tag: "dry run" | "failed" | "bulk" | null
}

const THING: Record<string, string> = {
  clients: "client",
  client_team: "team member",
  client_team_invites: "team invite",
  team_invites: "invite",
  profiles: "profile",
  client_platform_accounts: "ad account",
  conversion_field_tiers: "result tier",
  client_budgets: "budget",
  client_goals: "goal",
  client_goal_values: "goal figure",
  check_definitions: "check",
  check_runs: "check run",
  check_results: "check",
  sprints: "sprint",
  sprint_tests: "sprint test",
  sprint_items: "sprint item",
  sprint_changes: "logged change",
  sprint_ai_runs: "Pour a Sprint run",
  sprint_recommendations: "sprint suggestion",
  insight_actions: "recommendation",
  call_commitment_actions: "call follow-up",
  client_calls: "call",
  client_knowledge: "brain source",
  client_briefs: "client brief",
  content_idea_actions: "content idea",
  content_pieces: "content piece",
  content_sequences: "email sequence",
  client_competitors: "competitor",
  competitor_keywords: "keyword",
  report_links: "report link",
  feedback: "feedback",
  ad_creatives: "ad",
  campaign_builds: "campaign build",
}

export const thingFor = (table: string) => THING[table] ?? table.replace(/_/g, " ")

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Column names as words: "monthly_kpi_target" → "monthly KPI target", "owner_profile_id" → "owner". */
export function fieldLabel(column: string) {
  return column
    .replace(/_profile_id$|_by_profile_id$/, "")
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b(kpi|url|utm|icp|ga4|cta)\b/gi, (w) => w.toUpperCase())
}

/** A logged value in a few words. Ids aren't meaningful to read, so they show as "set". */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty"
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "number") return String(v)
  if (typeof v === "string") {
    if (UUID.test(v)) return "set"
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
    return v.length > 60 ? `“${v.slice(0, 57)}…”` : `“${v}”`
  }
  if (Array.isArray(v)) return v.length ? v.map((x) => valueText(x).replace(/[“”]/g, "")).join(", ").slice(0, 80) : "none"
  return "changed"
}

type Change = { from: unknown; to: unknown }
const isChange = (v: unknown): v is Change => !!v && typeof v === "object" && "from" in v && "to" in v

/** "Added a sprint test “X”", "Archived the sprint test “X”", "Changed the budget". */
export function describeChange(row: { table_name: string; op: string; label: string | null; changes: unknown }): { title: string; details: string[] } {
  const thing = thingFor(row.table_name)
  const named = row.label ? ` “${row.label.length > 80 ? `${row.label.slice(0, 77)}…` : row.label}”` : ""
  const changes = (row.changes && typeof row.changes === "object" ? row.changes : {}) as Record<string, unknown>

  if (row.op === "insert") {
    const details = Object.entries(changes)
      .filter(([k]) => !["client_id", "title", "name", "label"].includes(k) && !k.endsWith("_profile_id"))
      .slice(0, 4)
      .map(([k, v]) => `${fieldLabel(k)}: ${valueText(v)}`)
    return { title: `Added a ${thing}${named}`, details }
  }
  if (row.op === "delete") return { title: `Deleted a ${thing}${named}`, details: [] }

  const entries = Object.entries(changes).filter(([, v]) => isChange(v)) as [string, Change][]
  const set = (k: string) => entries.find(([key, v]) => key === k && v.from == null && v.to != null)
  const unset = (k: string) => entries.find(([key, v]) => key === k && v.from != null && v.to == null)
  const verb = set("archived_at") ? "Archived" : set("removed_at") || set("revoked_at") ? "Removed" : unset("archived_at") || unset("removed_at") ? "Brought back" : "Changed"
  const details = entries
    .filter(([k]) => !["archived_at", "removed_at", "revoked_at", "updated_by_profile_id"].includes(k))
    .map(([k, v]) => `${fieldLabel(k)}: ${valueText(v.from)} → ${valueText(v.to)}`)
  return { title: `${verb} the ${thing}${named}`, details }
}

const PLATFORM_OP: Record<string, string> = {
  push_negative_keywords: "Added negative keywords",
  create_responsive_search_ad: "Created a search ad (paused)",
  pause_ad: "Paused an ad",
  create_campaign_group: "Created a campaign group (draft)",
  create_campaign: "Created a campaign (paused)",
  create_ad_group: "Created an ad group (paused)",
  upload_image: "Uploaded an image",
  create_post: "Created a dark post",
  create_ad: "Created an ad (paused)",
}

export function describePlatformWrite(row: { operation: string; campaign_id: string | null; ad_id: string | null; payload: unknown }): { title: string; details: string[] } {
  const raw = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>
  // Windsor writes keep the action's arguments under params; direct API calls log the body itself.
  const p = (raw.params && typeof raw.params === "object" ? raw.params : raw) as Record<string, unknown>
  const details: string[] = []
  const keywords = Array.isArray(p.keywords) ? p.keywords : null
  if (keywords) {
    const words = keywords.map((k) => (k && typeof k === "object" && "text" in k ? String(k.text) : String(k)))
    details.push(`${words.length} term${words.length === 1 ? "" : "s"}: ${words.slice(0, 5).join(", ")}${words.length > 5 ? "…" : ""}`)
  }
  if (typeof p.name === "string") details.push(`name: “${p.name}”`)
  if (row.campaign_id) details.push(`campaign ${row.campaign_id}`)
  if (row.ad_id) details.push(`ad ${row.ad_id}`)
  return { title: PLATFORM_OP[row.operation] ?? row.operation.replace(/_/g, " "), details }
}

const NOTION_OP: Record<string, string> = {
  create_action: "Created a Notion action",
  create_test_brief: "Briefed a test in Notion",
  create_comment: "Commented on a Notion brief",
  create_sequence_brief: "Briefed an email sequence in Notion",
}

export function describeNotionWrite(row: { operation: string; payload: unknown }): { title: string; details: string[] } {
  const p = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>
  // A page's title is in Project; a comment has its text instead.
  const project = (p.properties as { Project?: { title?: { text?: { content?: string } }[] } } | undefined)?.Project?.title?.[0]?.text?.content
  const comment = (p.rich_text as { text?: { content?: string } }[] | undefined)?.[0]?.text?.content
  const title = project ?? (comment ? comment.split("\n")[0].slice(0, 100) : null)
  return { title: NOTION_OP[row.operation] ?? row.operation.replace(/_/g, " "), details: title ? [`“${title}”`] : [] }
}
