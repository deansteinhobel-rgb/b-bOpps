"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { longDate, money } from "@/lib/format"
import { writeDeps } from "@/lib/notion/server"
import { createNotionAction } from "@/lib/notion/write"
import { peopleForClient } from "@/lib/people"
import { carryTests } from "@/lib/sprints/data"
import { sprintByNumber } from "@/lib/sprints/periods"
import { briefText, READY_STATUSES, successLine } from "@/lib/sprints/tests"
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

/** Brief the team: creates ONE Notion brief row for the test via the single write function (dry run by default). */
export async function briefTest(testId: string): Promise<TestResult> {
  const me = await getProfile()
  const { test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  if (test.status !== "planned") return fail("This test has already been briefed.")
  if (!test.owner_notion_user_id) return fail("Pick an owner with a Notion user before briefing.")
  const client = test.clients as { id: string; slug: string; name: string; currency: string; notion_client_option: string }
  const sprint = test.sprints as { number: number; start_date: string; end_date: string }
  const appPath = `/clients/${client.slug}/sprint#test-${test.id}`
  const description = briefText({
    sprintNumber: sprint.number,
    sprintDates: `${longDate(sprint.start_date)} – ${longDate(sprint.end_date)}`,
    platform: test.platform,
    title: test.title,
    hypothesis: test.hypothesis,
    assets: test.assets,
    notes: test.brief_notes,
    success: successLine(test.success_metric, test.success_target === null ? null : Number(test.success_target), test.success_text, (v) => money(v, client.currency)),
    deadline: test.deadline ? longDate(test.deadline) : null,
    owner: test.owner_name,
    appUrl: `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${appPath}`,
  })
  const res = await createNotionAction(writeDeps(), {
    client: { id: client.id, slug: client.slug, notion_client_option: client.notion_client_option },
    title: `Paid media test: ${test.title}`.slice(0, 200),
    owner: { id: test.owner_notion_user_id, full_name: test.owner_name, notion_user_id: test.owner_notion_user_id },
    dueDate: test.deadline,
    description,
    sprintTestId: test.id,
    appLink: appPath,
    createdBy: { id: me.id, full_name: me.full_name, email: me.email },
  })
  refresh(client.slug)
  if (res.status === "failed") return fail(res.error)
  if (res.status === "dry_run") return { ok: true, dryRun: true, payload: res.payload, message: "Test mode: nothing was sent to Notion. This is the brief that would be created." }
  return { ok: true, url: res.page.url, message: "Brief created in Notion." }
}

/**
 * Test mode, or a brief made outside the app: move a planned/briefed test to "ready" by hand.
 * With a real Notion brief the app moves it automatically, so this isn't offered then.
 */
export async function markReadyManually(testId: string): Promise<TestResult> {
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  if (test.notion_page_id) return fail("This test has a Notion brief: it becomes ready when Notion says Client Approved or Production Complete.")
  if (!["planned", "briefed"].includes(test.status)) return fail("This test is past that stage.")
  await supabase.from("sprint_tests").update({ status: "ready", ready_at: new Date().toISOString() }).eq("id", testId)
  refresh((test.clients as { slug: string }).slug)
  return { ok: true }
}

export async function markLive(testId: string, raw: { live_on: string; campaigns: { id: string; name: string }[] }): Promise<TestResult> {
  const parsed = z
    .object({ live_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the live date."), campaigns: z.array(z.object({ id: z.string().max(100), name: z.string().max(400) })).max(30) })
    .safeParse(raw)
  if (!parsed.success) return fail(parsed.error.issues[0].message)
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  let ready = test.status === "ready"
  if (!ready && test.status === "briefed" && test.notion_page_id) {
    const { data: page } = await supabase.from("notion_pages_mirror").select("properties").eq("notion_page_id", test.notion_page_id).maybeSingle()
    ready = READY_STATUSES.includes(String((page?.properties as Record<string, unknown> | undefined)?.["Master Status"] ?? ""))
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
  const { supabase, test, error } = await loadTest(testId)
  if (!test) return fail(error!)
  await supabase.from("sprint_tests").update({ outcome: null, carry_reason: null, carry_note: null }).eq("id", testId)
  refresh((test.clients as { slug: string }).slug)
  return { ok: true }
}

