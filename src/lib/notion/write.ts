/**
 * THE ONLY PLACE THE APP WRITES TO NOTION (CLAUDE.md "Notion write-side rules").
 *
 * It only ever CREATES pages on the Master Production board, of two kinds:
 *   - an action (from a red check or the New action form), and
 *   - a sprint test brief (briefing the team on a planned test; Dean, 2026-09-28).
 * A page can get ONE comment, added straight after the app creates it (the brief for the team, with
 * people tagged; Dean, 2026-09-30). No updates, no deletes, no edits to pages the app didn't create.
 *
 * Every call to Notion: 1) logs to notion_write_log first, 2) calls Notion only if BOTH
 * NOTION_WRITES_ENABLED=true and NOTION_DRY_RUN=false (and, while NOTION_LIVE_CLIENTS is set, only
 * for those clients), 3) updates the log with the result, 4) upserts the mirror so the UI shows the
 * new action straight away. If the log can't be written, Notion is never called.
 */
import { ACTION_DEFAULTS, APP_CREATED_PREFIX, briefTitle, PROP, TEST_BRIEF_STATUS_CONTENT, type Priority } from "./config"
import { toMirrorRow, type NotionPage } from "./map"

export type ActionInput = {
  client: { id: string; slug: string; notion_client_option: string }
  title: string
  owner: { id: string; full_name: string | null; notion_user_id: string | null }
  /** More Project Leads (Notion user IDs) besides the owner. */
  coLeadIds?: string[]
  priority?: Priority | null
  dueDate: string | null
  description: string
  checkResultId?: string | null
  /** Set for a sprint test brief: the test the page briefs. */
  sprintTestId?: string | null
  /** Overrides the "QA Document" link back into the app (a path like /clients/x/sprint, or a full URL). */
  appLink?: string
  createdBy: { id: string; full_name: string | null; email: string }
  /** A comment on the new page. Each "@Name" of a tagged person becomes a Notion mention. */
  comment?: { text: string; mentions: { id: string; name: string }[] } | null
}

export type WriteOperation = "create_action" | "create_test_brief" | "create_comment"

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
  /** Only created when writes are live. Only `pages.create` and `comments.create` are ever called. */
  notion: { pages: { create(args: object): Promise<unknown> }; comments?: { create(args: object): Promise<unknown> } } | null
  env: {
    writesEnabled: boolean
    dryRun: boolean
    dataSourceId: string
    appUrl: string
    /** NOTION_LIVE_CLIENTS: when set, only these client slugs are written for real. */
    liveClients?: string[] | null
  }
  notifySlack?: (text: string) => Promise<void>
}

export type CommentResult = { status: "dry_run" | "created" | "failed"; payload: CommentPayload; error?: string }

export type WriteResult =
  | { status: "dry_run"; logId: number; payload: ActionPayload; comment?: CommentResult }
  | { status: "created"; logId: number; payload: ActionPayload; page: { id: string; url: string }; comment?: CommentResult }
  | { status: "failed"; logId: number | null; payload: ActionPayload | null; error: string }

export type ActionPayload = { parent: { data_source_id: string }; properties: Record<string, unknown> }
export type RichTextItem = { type: "text"; text: { content: string; link?: { url: string } } } | { type: "mention"; mention: { user: { id: string } } }
export type CommentPayload = { parent: { page_id: string }; rich_text: RichTextItem[] }

const MAX_TEXT = 2000 // Notion's limit per rich text item

function richText(s: string) {
  const chunks: { type: "text"; text: { content: string } }[] = []
  for (let i = 0; i < s.length && chunks.length < 100; i += MAX_TEXT) chunks.push({ type: "text", text: { content: s.slice(i, i + MAX_TEXT) } })
  return chunks
}

type Mention = { id: string; name: string }
const uniquePeople = (mentions: Mention[]) => [...new Map(mentions.filter((m) => m.id && m.name.trim()).map((m) => [m.id, m])).values()]

/** The comment as the team will read it: anyone tagged but not named in the text is greeted at the top ("Hey @A, @B"). */
export function commentBody(text: string, mentions: Mention[]) {
  const body = text.trim()
  const missing = uniquePeople(mentions).filter((p) => !body.includes(`@${p.name}`))
  return missing.length ? `Hey ${missing.map((p) => `@${p.name}`).join(", ")}\n\n${body}` : body
}

const URL_RE = /https?:\/\/[^\s<>"]+/g
const TRAILING_PUNCT = /[.,;:!?)\]']+$/ // "see https://x.com/a." links to https://x.com/a

/** The comment's rich text: every URL becomes a link, and every "@Name" of a tagged person becomes a Notion mention (which notifies them). */
export function commentRichText(text: string, mentions: Mention[]): RichTextItem[] {
  const people = uniquePeople(mentions).sort((a, b) => b.name.length - a.name.length) // longest name first
  const out: RichTextItem[] = []
  const pushPlain = (t: string) => {
    for (let i = 0; i < t.length; i += MAX_TEXT) out.push({ type: "text", text: { content: t.slice(i, i + MAX_TEXT) } })
  }
  // Notion only makes text clickable when it's sent with a link, so every http(s) URL becomes one.
  const pushText = (t: string) => {
    let last = 0
    for (const m of t.matchAll(URL_RE)) {
      const url = m[0].replace(TRAILING_PUNCT, "")
      if (m.index > last) pushPlain(t.slice(last, m.index))
      if (url.length <= MAX_TEXT) out.push({ type: "text", text: { content: url, link: { url } } })
      else pushPlain(url)
      last = m.index + url.length
    }
    if (last < t.length) pushPlain(t.slice(last))
  }
  let rest = commentBody(text, mentions)
  while (rest) {
    let hit: { at: number; p: Mention } | null = null
    for (const p of people) {
      const at = rest.indexOf(`@${p.name}`)
      if (at >= 0 && (!hit || at < hit.at)) hit = { at, p }
    }
    if (!hit) {
      pushText(rest)
      break
    }
    if (hit.at > 0) pushText(rest.slice(0, hit.at))
    out.push({ type: "mention", mention: { user: { id: hit.p.id } } })
    rest = rest.slice(hit.at + hit.p.name.length + 1)
  }
  return out.slice(0, 100)
}

export function buildCommentPayload(pageId: string, comment: NonNullable<ActionInput["comment"]>): CommentPayload {
  return { parent: { page_id: pageId }, rich_text: commentRichText(comment.text, comment.mentions) }
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
  if (input.comment && input.comment.text.length > 10_000) return "Keep the comment under 10,000 characters."
  return null
}

/** The exact page we would create. Existing properties and options only (no new ones, ever). */
export function buildActionPayload(input: ActionInput, env: Pick<WriteDeps["env"], "dataSourceId" | "appUrl">): ActionPayload {
  const createdByName = input.createdBy.full_name ?? input.createdBy.email
  const leads = [...new Set([input.owner.notion_user_id, ...(input.coLeadIds ?? [])].filter((id): id is string => Boolean(id)))]
  const title = input.sprintTestId ? briefTitle(input.title) : input.title.trim()
  const properties: Record<string, unknown> = {
    [PROP.title]: { title: richText(title) },
    [PROP.client]: { select: { name: input.client.notion_client_option } },
    [PROP.owner]: { people: leads.map((id) => ({ id })) },
    [PROP.status]: { status: { name: ACTION_DEFAULTS.status } },
    [PROP.productionType]: { select: { name: ACTION_DEFAULTS.productionType } },
    [PROP.createdBy]: { rich_text: richText(APP_CREATED_PREFIX + createdByName) },
    [PROP.description]: { rich_text: richText(input.description.trim()) },
    [PROP.appLink]: { url: appLinkFor(input, env.appUrl) },
  }
  if (input.dueDate) properties[PROP.dueDate] = { date: { start: input.dueDate } }
  if (input.priority) properties[PROP.priority] = { select: { name: input.priority } }
  if (input.sprintTestId) properties[PROP.statusContent] = { select: { name: TEST_BRIEF_STATUS_CONTENT } }
  return { parent: { data_source_id: env.dataSourceId }, properties }
}

export async function createNotionAction(deps: WriteDeps, input: ActionInput): Promise<WriteResult> {
  const invalid = validateActionInput(input)
  if (invalid) return { status: "failed", logId: null, payload: null, error: invalid }

  const clientAllowed = !deps.env.liveClients || deps.env.liveClients.includes(input.client.slug.toLowerCase())
  const live = deps.env.writesEnabled && !deps.env.dryRun && clientAllowed
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
  const finishLog = (id: number, values: object) => deps.db.from("notion_write_log").update({ ...values, completed_at: new Date().toISOString() }).eq("id", id)
  const finish = (values: object) => finishLog(logId, values)
  const note = clientAllowed ? "NOTION_WRITES_ENABLED/NOTION_DRY_RUN: nothing was sent to Notion" : "NOTION_LIVE_CLIENTS: live writes are off for this client, nothing was sent to Notion"

  // The comment on the new page: its own log row, written before its own call. Only ever on a page
  // this call just created.
  const addComment = async (pageId: string | null): Promise<CommentResult | undefined> => {
    if (!input.comment?.text.trim()) return undefined
    const commentPayload = buildCommentPayload(pageId ?? "(the new page)", input.comment)
    const { data: clog, error: clogError } = await deps.db
      .from("notion_write_log")
      .insert({
        profile_id: input.createdBy.id,
        client_id: input.client.id,
        check_result_id: input.checkResultId ?? null,
        sprint_test_id: input.sprintTestId ?? null,
        operation: "create_comment" satisfies WriteOperation,
        endpoint: "POST /v1/comments",
        payload: commentPayload,
        dry_run: !pageId,
      })
      .select("id")
      .single()
    if (clogError || !clog) return { status: "failed", payload: commentPayload, error: "Couldn't write the log, so the comment wasn't sent." }
    const commentLogId = clog.id as number
    if (!pageId || !deps.notion?.comments) {
      await finishLog(commentLogId, { success: true, response: { dry_run: true, note } })
      return { status: "dry_run", payload: commentPayload }
    }
    try {
      const c = (await deps.notion.comments.create(commentPayload)) as { id: string }
      await finishLog(commentLogId, { success: true, response: { id: c.id } })
      return { status: "created", payload: commentPayload }
    } catch (e) {
      const message = (e as Error).message
      await finishLog(commentLogId, { success: false, response: { error: message } })
      return { status: "failed", payload: commentPayload, error: message }
    }
  }

  // 2. Dry run: stop here. This is the default everywhere until Dean switches it on.
  if (!live || !deps.notion) {
    await finish({ success: true, response: { dry_run: true, note } })
    return { status: "dry_run", logId, payload, comment: await addComment(null) }
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
  const comment = await addComment(page.id)

  if (deps.notifySlack) {
    await deps
      .notifySlack(`New action for ${input.client.notion_client_option}: ${input.title} · owner ${input.owner.full_name ?? "?"} · ${page.url}`)
      .catch((e) => console.error("Slack notification failed", e))
  }
  return { status: "created", logId, payload, page: { id: page.id, url: page.url }, comment }
}
