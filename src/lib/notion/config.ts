/**
 * Notion mapping confirmed with Dean in Phase 0 (CLAUDE.md "Notion mapping"). Existing properties
 * only: never add properties or select options, because B&B's Notion automations depend on them.
 */
export const NOTION_VERSION = "2026-03-11"

export const PROP = {
  title: "Project",
  client: "Client", // select
  owner: "Project Lead", // people
  dueDate: "Date of Brief - Completion of Project", // date
  status: "Master Status", // status
  productionType: "Production Type", // select
  createdBy: "Brief Submitted by", // rich_text
  description: "Description of Request", // rich_text
  appLink: "QA Document", // url
  parent: "Parent item", // relation
  priority: "Priority", // select
  statusPaid: "Status Paid", // select
  statusContent: "Status Content", // select
  statusProofing: "Status Proofing", // select
  statusAutomation: "Status Automation", // select
  statusDesign: "Status Design", // select
  statusReporting: "Status Reporting", // select
  vertical: "Vertical", // select
} as const

/**
 * Briefs tab shows paid media work only (Dean): Production Type is one of these, or "Status Paid"
 * is set to anything but N/A. Sub-items of a matching parent are shown too.
 */
export const PAID_PRODUCTION_TYPES = ["Paid Media", "Google Ad Campaign"]

/** Values the app writes when it creates an action. */
export const ACTION_DEFAULTS = {
  status: "New",
  productionType: "Paid Media",
} as const

/** Existing Priority options (never add new ones). */
export const PRIORITIES = ["High", "Medium", "Low"] as const
export type Priority = (typeof PRIORITIES)[number]

/** A sprint test brief goes straight to the copywriter (Dean, 2026-09-30). An existing option. */
export const TEST_BRIEF_STATUS_CONTENT = "Ready for Copy"

/**
 * An email sequence brief from the content library (Dean, 2026-10-14). Every value is an existing
 * option on Master Production (checked read-only 2026-10-14), the same as the Camber content library
 * artifact set: copy and proofing and automation to do, no design, paid or reporting work.
 */
export const SEQUENCE_BRIEF = {
  productionType: "Email",
  statusContent: "Ready for Copy",
  statusProofing: "Pending",
  statusAutomation: "Pending",
  statusDesign: "N/A",
  statusPaid: "N/A",
  statusReporting: "N/A",
} as const

/** Sprint test briefs are named "Lumaux | Paid Media | {test name}" (Dean, 2026-09-30). */
export const BRIEF_TITLE_PREFIX = "Lumaux | Paid Media | "
export const briefTitle = (testTitle: string) => `${BRIEF_TITLE_PREFIX}${testTitle.trim()}`.slice(0, 200)

/**
 * NOTION_LIVE_CLIENTS (comma-separated client slugs, e.g. "dnsfilter"): while it's set, live writes
 * only happen for those clients; every other client stays a dry run. Unset means no restriction
 * (the two main switches still apply).
 */
export function liveClientSlugs(raw = process.env.NOTION_LIVE_CLIENTS): string[] | null {
  const list = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  return list.length ? list : null
}

/** Prefix on "Brief Submitted by" that marks a row as created by this app. */
export const APP_CREATED_PREFIX = "B&B Ops app · "

/** The only "closed" status. Everything else counts as open. */
export const CLOSED_STATUSES = ["Production Complete"]

/** Master Production: the ONLY Notion data source the app may read or write (Dean, 2026-09-28). */
export const MASTER_PRODUCTION_DATA_SOURCE_ID = "2716e9bb-1958-81b0-a4e2-000bf0330ac3"

export const dataSourceId = () => {
  const id = process.env.NOTION_DATA_SOURCE_ID
  if (!id) throw new Error("NOTION_DATA_SOURCE_ID is not set")
  if (id.replace(/-/g, "") !== MASTER_PRODUCTION_DATA_SOURCE_ID.replace(/-/g, "")) {
    throw new Error("NOTION_DATA_SOURCE_ID must be the Master Production board. The app never uses any other Notion database.")
  }
  return MASTER_PRODUCTION_DATA_SOURCE_ID
}

/**
 * The Content Bank (Dean, 2026-10-15): one row per content piece, transcript or source note, for
 * every client, told apart by a free-text "Client" property. READ ONLY, never written: each row
 * feeds only the brain of the client its Client names (`src/lib/knowledge/content-bank.ts`).
 */
export const CONTENT_BANK = {
  databaseId: "8257ba939dc04875a56b8858f095dae6",
  dataSourceId: "9c8e8d69-df62-40d7-858a-0c570c614790",
  prop: { title: "Title", client: "Client", format: "Format", tags: "Tags", summary: "Summary", sourceNote: "Source Note", dateAdded: "Date Added", addedBy: "Added By" },
} as const
