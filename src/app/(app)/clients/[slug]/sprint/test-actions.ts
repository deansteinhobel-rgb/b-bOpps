"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { longDate, money } from "@/lib/format"
import { liveClientSlugs, PRIORITIES, TEST_TITLE_PREFIX, type Priority } from "@/lib/notion/config"
import { notionWritesLive, writeDeps } from "@/lib/notion/server"
import { listNotionPeople } from "@/lib/notion/users"
import { commentBody, createNotionAction } from "@/lib/notion/write"
import { peopleForClient } from "@/lib/people"
import { carryTests } from "@/lib/sprints/data"
import { sprintByNumber } from "@/lib/sprints/periods"
import { guessPlatform, NEEDS_PLATFORMS, needsText, type NeedsPlatform } from "@/lib/sprints/brief-needs"
import { briefText, notionStage, successLine } from "@/lib/sprints/tests"
import { createClient } from "@/lib/supabase/server"

// All as the signed-in user (RLS: the client's team and admins). Nothing is deleted. Once a sprint
// is closed its tests are read-only.

export type TestResult = { ok: boolean; message?: string; payload?: unknown; url?: string; dryRun?: boolean }
const fail = (message: string): TestResult => ({ ok: false, message })
const PlatformEnum = z.enum(["linkedin", "google_ads", "meta"])

async function loadTest(testId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("sprint_tests")
    .select("*, sprints(id, number, start_date, end_date, closed_at), clients(id, slug, name, currency, notion_client_option)")
    .eq("id", testId)
    .maybeSingle()
  if (!data) return { supabase, test: null, error: "This test isn't available to you." }
  if (data.sprints?.closed_at) return { supabase, test: null, error: "This sprint is closed." }
  return { supabase, test: data, error: null }
}
const refresh = (slug: string) => revalidatePath(`/clients/${slug}/sprint`)

const Plan = z.object({
  platform: PlatformEnum.nullable(),
  title: z.string().trim().min(1, "Say what you're testing.").max(200),
  hypothesis: z.string().trim().max(1000).optional().default(""),
  assets: z.array(z.string().max(40)).max(10),
  brief_notes: z.string().trim().max(3000).optional().default(""),
  success_metric: z.string().max(40).nullable(),
  success_target: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().nonnegative().nullable()),
  success_text: z.string().trim().max(500).optional().default(""),
  owner_notion_user_id: z.string().max(60).nullable(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

export async function planTest(sprintId: string, raw: z.input<typeof Plan>): Promise<TestResult> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  const parsed = Plan.safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)
  const p = parsed.data
  if (!p.success_text && (p.success_metric === null || p.success_target === null)) return fail("Say what success looks like: a target, or a sentence.")
  const me = await getProfile()
  const supabase = await createClient()
  const { data: sprint } = await supabase.from("sprints").select("id, client_id, closed_at, clients(slug)").eq("id", sprintId).maybeSingle()
  if (!sprint) return fail("This sprint isn't available to you.")
  if (sprint.closed_at) return fail("This sprint is closed.")
  const owner = p.owner_notion_user_id ? (await peopleForClient(supabase, sprint.client_id)).find((x) => x.notionUserId === p.owner_notion_user_id) : null
  const { error } = await supabase.from("sprint_tests").insert({
    sprint_id: sprintId,
    client_id: sprint.client_id,
    platform: p.platform,
    title: p.title,
    hypothesis: p.hypothesis || null,
    assets: p.assets,
    brief_notes: p.brief_notes || null,
    success_metric: p.success_metric,
    success_target: p.success_target,
    success_text: p.success_text || null,
    owner_notion_user_id: owner?.notionUserId ?? null,
    owner_name: owner?.name ?? null,
    deadline: p.deadline,
    created_by_profile_id: me.id,
  })
  if (error) return fail("Couldn't save the test.")
  refresh((sprint.clients as unknown as { slug: string }).slug)
  return { ok: true }
}

type TestRow = NonNullable<Awaited<ReturnType<typeof loadTest>>["test"]>
type TestClient = { id: string; slug: string; name: string; currency: string; notion_client_option: string }

function briefParts(test: TestRow, over: { owner: string | null; deadline: string | null; needs?: string | null }) {
  const client = test.clients as TestClient
  const sprint = test.sprints as { number: number; start_date: string; end_date: string }
  const appPath = `/clients/${client.slug}/sprint#test-${test.id}`
  const appUrl = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${appPath}`
  const success = successLine(test.success_metric, test.success_target === null ? null : Number(test.success_target), test.success_text, (v) => money(v, client.currency))
  const common = { sprintNumber: sprint.number, platform: test.platform, title: test.title, hypothesis: test.hypothesis, assets: test.assets, notes: test.brief_notes, success, appUrl }
  const deadline = over.deadline ? longDate(over.deadline) : null
  return {
    client,
    appPath,
    description: briefText({ ...common, sprintDates: `${longDate(sprint.start_date)} – ${longDate(sprint.end_date)}`, deadline, owner: over.owner, needs: over.needs }),
    /** What the pop-up needs to draft the comment itself (briefComment), as "What we need" changes. */
    commentParts: { sprintNumber: sprint.number, title: test.title, hypothesis: test.hypothesis, notes: test.brief_notes, success, appUrl },
  }
}

export type BriefPerson = { id: string; name: string; onTeam: boolean }
export type BriefOptions = {
  people: BriefPerson[]
  leadIds: string[]
  dueDate: string | null
  priority: Priority
  platform: NeedsPlatform
  commentParts: { sprintNumber: number; title: string; hypothesis: string | null; notes: string | null; success: string; appUrl: string }
  title: string
  live: boolean
}

/** What the "Brief the team" form needs: Notion people (read only), and defaults from the test. */
export async function briefOptions(testId: string): Promise<{ ok: true; options: BriefOptions } | { ok: false; message: string }> {
  if (!canEdit(await getProfile())) return { ok: false, message: VIEW_ONLY }
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return { ok: false, message: error! }
  if (test.status !== "planned") return { ok: false, message: "This test has already been briefed." }
  const [workspace, team] = await Promise.all([listNotionPeople().catch(() => []), peopleForClient(supabase, test.client_id)])
  const onTeam = new Set(team.filter((p) => p.onTeam && p.notionUserId).map((p) => p.notionUserId))
  const people = workspace.map((p) => ({ id: p.id, name: p.name, onTeam: onTeam.has(p.id) })).sort((a, b) => Number(b.onTeam) - Number(a.onTeam) || a.name.localeCompare(b.name))
  const { client, commentParts } = briefParts(test, { owner: test.owner_name, deadline: test.deadline })
  return {
    ok: true,
    options: {
      people,
      leadIds: test.owner_notion_user_id ? [test.owner_notion_user_id] : [],
      dueDate: test.deadline,
      priority: "Medium",
      platform: guessPlatform(test.platform, test.title),
      commentParts,
      title: `${TEST_TITLE_PREFIX}Paid media test: ${test.title}`,
      live: notionWritesLive(client.slug),
    },
  }
}

const Brief = z.object({
  leadIds: z.array(z.string().max(60)).min(1, "Pick at least one project lead.").max(6),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date."),
  priority: z.enum(PRIORITIES),
  tagIds: z.array(z.string().max(60)).max(10),
  comment: z.string().max(10_000),
  needs: z.object({
    platform: z.enum(NEEDS_PLATFORMS as [NeedsPlatform, ...NeedsPlatform[]]),
    formats: z.record(z.string().max(40), z.number().int().min(0).max(50)),
    leadForm: z.boolean(),
    leadFormQty: z.number().int().min(0).max(20),
    notes: z.string().max(3000),
    designNotes: z.string().max(3000),
  }),
})

/**
 * Brief the team: creates ONE Master Production row for the test, then its first comment with the
 * tagged people, via the single write function (dry run by default).
 */
export async function briefTest(testId: string, raw: z.input<typeof Brief>): Promise<TestResult & { comment?: string; commentStatus?: string }> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  const parsed = Brief.safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)
  const b = parsed.data
  const me = await getProfile()
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  if (test.status !== "planned") return fail("This test has already been briefed.")
  // Names come from Notion, never from the browser.
  const byId = new Map((await listNotionPeople()).map((p) => [p.id, p]))
  const leads = b.leadIds.map((id) => byId.get(id))
  const tags = b.tagIds.map((id) => byId.get(id))
  if (leads.some((p) => !p) || tags.some((p) => !p)) return fail("Someone you picked isn't in Notion any more. Reload and try again.")
  const owner = leads[0]!
  const leadNames = leads.map((p) => p!.name).join(", ")
  const { client, appPath, description } = briefParts(test, { owner: leadNames, deadline: b.dueDate, needs: needsText(b.needs) })
  const mentions = tags.map((p) => ({ id: p!.id, name: p!.name }))
  const res = await createNotionAction(writeDeps(), {
    client: { id: client.id, slug: client.slug, notion_client_option: client.notion_client_option },
    title: `Paid media test: ${test.title}`.slice(0, 200),
    owner: { id: owner.id, full_name: owner.name, notion_user_id: owner.id },
    coLeadIds: leads.slice(1).map((p) => p!.id),
    priority: b.priority,
    dueDate: b.dueDate,
    description,
    sprintTestId: test.id,
    appLink: appPath,
    createdBy: { id: me.id, full_name: me.full_name, email: me.email },
    comment: b.comment.trim() ? { text: b.comment, mentions } : null,
  })
  if (res.status === "created") {
    // Keep the test in step with what the team was told.
    await supabase.from("sprint_tests").update({ owner_notion_user_id: owner.id, owner_name: owner.name, deadline: b.dueDate }).eq("id", test.id)
  }
  refresh(client.slug)
  if (res.status === "failed") return fail(res.error)
  const commentText = b.comment.trim() ? commentBody(b.comment, mentions) : undefined
  if (res.status === "dry_run") {
    const why = notionWritesLive() && !notionWritesLive(client.slug) ? `Live writes are only on for ${liveClientSlugs()?.join(", ")}.` : "Test mode."
    return { ok: true, dryRun: true, payload: res.payload, comment: commentText, message: `${why} Nothing was sent to Notion. This is the brief that would be created.` }
  }
  const c = res.comment
  const message = c?.status === "failed" ? `Brief created in Notion, but the comment failed: ${c.error}` : c ? "Brief created in Notion, with the comment." : "Brief created in Notion."
  return { ok: c?.status !== "failed", url: res.page.url, message, commentStatus: c?.status }
}

/**
 * Test mode, or a brief made outside the app: move a planned/briefed test to "ready" by hand.
 * With a real Notion brief the app moves it automatically, so this isn't offered then.
 */
export async function markReadyManually(testId: string): Promise<TestResult> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  if (test.notion_page_id) return fail("This test has a Notion brief: it becomes ready when Status Paid is Ready for Build or Master Status is Client Approved.")
  if (!["planned", "briefed"].includes(test.status)) return fail("This test is past that stage.")
  await supabase.from("sprint_tests").update({ status: "ready", ready_at: new Date().toISOString() }).eq("id", testId)
  refresh((test.clients as { slug: string }).slug)
  return { ok: true }
}

export async function markLive(testId: string, raw: { live_on: string; campaigns: { id: string; name: string }[] }): Promise<TestResult> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  const parsed = z
    .object({ live_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the live date."), campaigns: z.array(z.object({ id: z.string().max(100), name: z.string().max(400) })).max(30) })
    .safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  // Ready, or already live (Notion moved it there and the team is now adding the campaigns).
  let ready = test.status === "ready" || test.status === "live"
  if (!ready && test.status === "briefed" && test.notion_page_id) {
    const { data: page } = await supabase.from("notion_pages_mirror").select("properties").eq("notion_page_id", test.notion_page_id).maybeSingle()
    const props = (page?.properties ?? {}) as Record<string, unknown>
    ready = notionStage({ master: (props["Master Status"] as string) ?? null, paid: (props["Status Paid"] as string) ?? null }) !== null
  }
  if (!ready) return fail("It isn't ready to launch yet.")
  await supabase
    .from("sprint_tests")
    .update({ status: "live", live_on: parsed.data.live_on, campaign_ids: parsed.data.campaigns.map((c) => c.id), campaign_names: parsed.data.campaigns.map((c) => c.name) })
    .eq("id", testId)
  refresh((test.clients as { slug: string }).slug)
  return { ok: true }
}

export async function saveFindings(testId: string, raw: { worked: string; blockers: string; notes: string }): Promise<TestResult> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  const clean = (s: string) => s.trim().slice(0, 3000) || null
  await supabase
    .from("sprint_tests")
    .update({
      findings_worked: clean(raw.worked),
      findings_blockers: clean(raw.blockers),
      findings_notes: clean(raw.notes),
      ...(test.status === "live" ? { status: "review" } : {}),
    })
    .eq("id", testId)
  refresh((test.clients as { slug: string }).slug)
  return { ok: true }
}

const Outcome = z.object({
  outcome: z.enum(["proven", "disproven", "inconclusive", "carried"]),
  carry_reason: z.enum(["deadline", "setup_time", "too_short_live", "awaiting_approval", "other"]).nullable(),
  carry_note: z.string().trim().max(1000).optional().default(""),
})

/** Proven / disproven / inconclusive, or carry over (with a reason) into the next sprint. */
export async function setOutcome(testId: string, raw: z.input<typeof Outcome>): Promise<TestResult> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  const parsed = Outcome.safeParse(raw)
  if (!parsed.success) return fail("Pick an outcome.")
  const o = parsed.data
  if (o.outcome === "carried" && !o.carry_reason) return fail("Say why it's carrying over.")
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  if (o.outcome !== "carried" && !["live", "review"].includes(test.status)) return fail("Only a test that went live can be proven, disproven or inconclusive. Carry it over instead.")
  await supabase
    .from("sprint_tests")
    .update({ outcome: o.outcome, carry_reason: o.outcome === "carried" ? o.carry_reason : null, carry_note: o.outcome === "carried" ? o.carry_note || null : null })
    .eq("id", testId)
  // If the next sprint already exists, carry it now; otherwise the next sprint picks it up when created.
  if (o.outcome === "carried") {
    const sprint = test.sprints as { id: string; number: number }
    const next = sprintByNumber(sprint.number + 1)
    const { data: nextSprint } = await supabase.from("sprints").select("id, client_id").eq("client_id", test.client_id).eq("start_date", next.start).maybeSingle()
    if (nextSprint) await carryTests(supabase, sprint.id, nextSprint)
  }
  refresh((test.clients as { slug: string }).slug)
  return { ok: true }
}

/** Undo an outcome while the sprint is still open. */
export async function clearOutcome(testId: string): Promise<TestResult> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  await supabase.from("sprint_tests").update({ outcome: null, carry_reason: null, carry_note: null }).eq("id", testId)
  refresh((test.clients as { slug: string }).slug)
  return { ok: true }
}

