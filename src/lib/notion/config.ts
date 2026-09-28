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
} as const

/** Values the app writes when it creates an action. */
export const ACTION_DEFAULTS = {
  status: "New",
  productionType: "Paid Media",
} as const

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
