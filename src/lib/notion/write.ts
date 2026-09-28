/**
 * THE ONLY PLACE THE APP WRITES TO NOTION (CLAUDE.md "Notion write-side rules").
 *
 * It only ever CREATES pages on the Master Production board, of two kinds:
 *   - an action (from a red check or the New action form), and
 *   - a sprint test brief (briefing the team on a planned test; Dean, 2026-09-28).
 * No updates, no deletes, no edits to pages the app didn't create.
 *
 * Every call: 1) logs to notion_write_log first, 2) calls Notion only if BOTH
 * NOTION_WRITES_ENABLED=true and NOTION_DRY_RUN=false, 3) updates the log with the result,
 * 4) upserts the mirror so the UI shows the new action straight away.
 * If the log can't be written, Notion is never called.
 */
import { ACTION_DEFAULTS, APP_CREATED_PREFIX, PROP } from "./config"
import { toMirrorRow, type NotionPage } from "./map"

export type ActionInput = {
  client: { id: string; slug: string; notion_client_option: string }
  title: string
  owner: { id: string; full_name: string | null; notion_user_id: string | null }
  dueDate: string | null
  description: string
  checkResultId?: string | null
  /** Set for a sprint test brief: the test the page briefs. */
  sprintTestId?: string | null
  /** Overrides the "QA Document" link back into the app (a path like /clients/x/sprint, or a full URL). */
  appLink?: string
  createdBy: { id: string; full_name: string | null; email: string }
}

export type WriteOperation = "create_action" | "create_test_brief"

/** Only what createNotionAction needs from Supabase (the admin client in production, a fake in tests). */
export type WriteDb = {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert(row: object): { select(cols: string): { single(): PromiseLike<{ data: any; error: { message: string } | null }> } }
    update(values: object): { eq(col: string, val: unknown): PromiseLike<{ error: { message: string } | null }> }
    upsert(rows: object, opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>
  }
}

export type WriteDeps = {
  db: WriteDb
  /** Only created when writes are live. Only `pages.create` is ever called. */
  notion: { pages: { create(args: object): Promise<unknown> } } | null
  env: { writesEnabled: boolean; dryRun: boolean; dataSourceId: string; appUrl: string }
  notifySlack?: (text: string) => Promise<void>
}

export type WriteResult =
  | { status: "dry_run"; logId: number; payload: ActionPayload }
  | { status: "created"; logId: number; payload: ActionPayload; page: { id: string; url: string } }
  | { status: "failed"; logId: number | null; payload: ActionPayload | null; error: string }

export type ActionPayload = { parent: { data_source_id: string }; properties: Record<string, unknown> }

const MAX_TEXT = 2000 // Notion's limit per rich text item

function richText(s: string) {
  const chunks: { type: "text"; text: { content: string } }[] = []
  for (let i = 0; i < s.length && chunks.length < 100; i += MAX_TEXT) chunks.push({ type: "text", text: { content: s.slice(i, i + MAX_TEXT) } })
  return chunks
}

export function appLinkFor(input: Pick<ActionInput, "client" | "checkResultId" | "appLink">, appUrl: string) {
  const base = appUrl.replace(/\/$/, "")
  if (input.appLink) return input.appLink.startsWith("http") ? input.appLink : `${base}${input.appLink}`
  return input.checkResultId ? `${base}/clients/${input.client.slug}/checks?result=${input.checkResultId}` : `${base}/clients/${input.client.slug}/actions`
}

export function validateActionInput(input: ActionInput): string | null {
  if (!input.title.trim()) return "Give the action a title."
  if (input.title.length > 200) return "Keep the title under 200 characters."
  if (!input.owner.notion_user_id) return `${input.owner.full_name ?? "That person"} isn't linked to a Notion user yet, so they can't own a Notion action.`
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return "Due date must be a date."
  if (!input.client.notion_client_option) return "This client isn't mapped to a Notion Client option."
  return null
}

/** The exact page we would create. Existing properties and options only (no new ones, ever). */
export function buildActionPayload(input: ActionInput, env: Pick<WriteDeps["env"], "dataSourceId" | "appUrl">): ActionPayload {
  const createdByName = input.createdBy.full_name ?? input.createdBy.email
  const properties: Record<string, unknown> = {
    [PROP.title]: { title: richText(input.title.trim()) },
    [PROP.client]: { select: { name: input.client.notion_client_option } },
    [PROP.owner]: { people: [{ id: input.owner.notion_user_id }] },
    [PROP.status]: { status: { name: ACTION_DEFAULTS.status } },
    [PROP.productionType]: { select: { name: ACTION_DEFAULTS.productionType } },
    [PROP.createdBy]: { rich_text: richText(APP_CREATED_PREFIX + createdByName) },
    [PROP.description]: { rich_text: richText(input.description.trim()) },
    [PROP.appLink]: { url: appLinkFor(input, env.appUrl) },
  }
  if (input.dueDate) properties[PROP.dueDate] = { date: { start: input.dueDate } }
  return { parent: { data_source_id: env.dataSourceId }, properties }
}

export async function createNotionAction(deps: WriteDeps, input: ActionInput): Promise<WriteResult> {
  const invalid = validateActionInput(input)
  if (invalid) return { status: "failed", logId: null, payload: null, error: invalid }

  const live = deps.env.writesEnabled && !deps.env.dryRun
  const payload = buildActionPayload(input, deps.env)
  const operation: WriteOperation = input.sprintTestId ? "create_test_brief" : "create_action"

  // 1. Log first. No log, no write.
  const { data: log, error: logError } = await deps.db
    .from("notion_write_log")
    .insert({
      profile_id: input.createdBy.id,
      client_id: input.client.id,
      check_result_id: input.checkResultId ?? null,
      sprint_test_id: input.sprintTestId ?? null,
      operation,
      endpoint: "POST /v1/pages",
      payload,
      dry_run: !live,
    })
    .select("id")
    .single()
  if (logError || !log) return { status: "failed", logId: null, payload, error: `Couldn't write the log, so nothing was sent to Notion. ${logError?.message ?? ""}`.trim() }
  const logId = log.id as number
  const finish = (values: object) => deps.db.from("notion_write_log").update({ ...values, completed_at: new Date().toISOString() }).eq("id", logId)

  // 2. Dry run: stop here. This is the default everywhere until Dean switches it on.
  if (!live || !deps.notion) {
    await finish({ success: true, response: { dry_run: true, note: "NOTION_WRITES_ENABLED/NOTION_DRY_RUN: nothing was sent to Notion" } })
    return { status: "dry_run", logId, payload }
  }

  // 3. The one real write.
  let page: NotionPage
  try {
    page = (await deps.notion.pages.create(payload)) as NotionPage
  } catch (e) {
    const message = (e as Error).message
    await finish({ success: false, response: { error: message } })
    return { status: "failed", logId, payload, error: `Notion rejected the action: ${message}` }
  }
  await finish({ success: true, response: { id: page.id, url: page.url } })

  // 4. Show it in the app straight away, and link it to the check.
  const clientIdByOption = new Map([[input.client.notion_client_option, input.client.id]])
  await deps.db.from("notion_pages_mirror").upsert(toMirrorRow(page, deps.env.dataSourceId, clientIdByOption), { onConflict: "notion_page_id" })
  if (input.checkResultId) await deps.db.from("check_results").update({ notion_action_page_id: page.id }).eq("id", input.checkResultId)
  if (input.sprintTestId) {
    await deps.db.from("sprint_tests").update({ notion_page_id: page.id, status: "briefed", briefed_at: new Date().toISOString() }).eq("id", input.sprintTestId)
  }

  if (deps.notifySlack) {
    await deps
      .notifySlack(`New action for ${input.client.notion_client_option}: ${input.title} · owner ${input.owner.full_name ?? "?"} · ${page.url}`)
      .catch((e) => console.error("Slack notification failed", e))
  }
  return { status: "created", logId, payload, page: { id: page.id, url: page.url } }
}
