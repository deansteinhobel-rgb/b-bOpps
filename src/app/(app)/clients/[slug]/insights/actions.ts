"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { loadFeed } from "@/lib/insights/feed"
import { RULES, type FeedInsight } from "@/lib/insights/rules"
import { writeDeps } from "@/lib/notion/server"
import { createNotionAction } from "@/lib/notion/write"
import { peopleForClient } from "@/lib/people"
import { ensureSprint } from "@/lib/sprints/data"
import { sprintOf } from "@/lib/sprints/periods"
import { createClient } from "@/lib/supabase/server"

// What the team does with an insight. All as the signed-in user (RLS: the client's team and
// admins), logged append-only in insight_actions. Nothing is written to the ad platforms (Dean:
// not until we have API access), nothing is deleted, and the Notion action goes through the one
// write function, dry run by default.

export type InsightResult = { ok: boolean; message?: string; payload?: unknown; url?: string; dryRun?: boolean }
const fail = (message: string): InsightResult => ({ ok: false, message })
const CONNECTED = ["linkedin", "google_ads", "meta"]

async function load(slug: string, key: string, items: string[]) {
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, name, currency, notion_client_option").eq("slug", slug).maybeSingle()
  if (!client) return { error: "This client isn't available to you." as const }
  const feed = await loadFeed(supabase, client.id) // access confirmed above
  const insight = feed?.insights.find((i) => i.key === key)
  if (!insight) return { error: "This insight has gone: the numbers changed since the page loaded." as const }
  const known = new Set(insight.items.map((x) => x.id))
  const chosen = items.filter((x) => known.has(x))
  return { supabase, client, insight, chosen }
}

/** What the insight looked like when someone acted on it, for tuning the rules later. */
const snapshot = (i: FeedInsight, items: string[]) => ({
  title: i.title,
  why: i.why,
  severity: i.severity,
  numbers: i.numbers,
  atStake: i.atStake,
  campaign: i.campaignName,
  items: i.items.filter((x) => !items.length || items.includes(x.id)).map((x) => ({ id: x.id, note: x.note ?? null })),
})

const refresh = (slug: string) => {
  revalidatePath(`/clients/${slug}/insights`)
  revalidatePath(`/clients/${slug}/performance`, "layout")
}

const Log = z.object({
  action: z.enum(["done", "dismissed", "snoozed", "reopened"]),
  items: z.array(z.string().max(600)).max(500),
  days: z.number().int().min(1).max(90).optional(),
  note: z.string().trim().max(500).optional(),
})

/** Done, dismiss (with an optional reason), snooze for N days, or reopen. `items` empty = the whole insight. */
export async function logInsight(slug: string, key: string, raw: z.input<typeof Log>): Promise<InsightResult> {
  const p = Log.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  const l = await load(slug, key, p.data.items)
  if ("error" in l) return fail(l.error!)
  const snoozeUntil = p.data.action === "snoozed" ? new Date(Date.parse(londonToday()) + (p.data.days ?? 7) * 864e5).toISOString().slice(0, 10) : null
  const { error } = await l.supabase.from("insight_actions").insert({
    client_id: l.client.id,
    insight_key: key,
    rule: l.insight.rule,
    action: p.data.action,
    items: p.data.action === "snoozed" || p.data.action === "reopened" ? [] : l.chosen,
    snooze_until: snoozeUntil,
    note: p.data.note || null,
    snapshot: snapshot(l.insight, l.chosen),
  })
  if (error) return fail("Couldn't save.")
  refresh(slug)
  return { ok: true }
}

const Brief = z.object({
  title: z.string().trim().min(1, "Give the action a title.").max(200),
  ownerNotionId: z.string().regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i, "Pick an owner."),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  description: z.string().trim().max(10000),
  items: z.array(z.string().max(600)).max(500),
})

/** Brief the team: one Notion action on the Master Production board (dry run until Dean switches writes on). */
export async function briefInsight(slug: string, key: string, raw: z.input<typeof Brief>): Promise<InsightResult> {
  const p = Brief.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  const l = await load(slug, key, p.data.items)
  if ("error" in l) return fail(l.error!)
  const me = await getProfile()
  const person = (await peopleForClient(l.supabase, l.client.id)).find((x) => x.notionUserId === p.data.ownerNotionId)
  if (!person) return fail("Pick an owner.")
  const res = await createNotionAction(writeDeps(), {
    client: { id: l.client.id, slug: l.client.slug, notion_client_option: l.client.notion_client_option },
    title: p.data.title,
    owner: { id: person.profileId ?? person.email, full_name: person.name, notion_user_id: person.notionUserId },
    dueDate: p.data.dueDate,
    description: p.data.description,
    appLink: `/clients/${slug}/insights?i=${encodeURIComponent(key)}`,
    createdBy: { id: me.id, full_name: me.full_name, email: me.email },
  })
  if (res.status === "failed") return fail(res.error)
  await l.supabase.from("insight_actions").insert({
    client_id: l.client.id,
    insight_key: key,
    rule: l.insight.rule,
    action: "briefed",
    items: l.chosen,
    note: res.status === "dry_run" ? "Test mode: nothing sent to Notion" : null,
    notion_log_id: res.logId,
    notion_page_id: res.status === "created" ? res.page.id : null,
    snapshot: snapshot(l.insight, l.chosen),
  })
  refresh(slug)
  revalidatePath(`/clients/${slug}/actions`)
  if (res.status === "dry_run") return { ok: true, dryRun: true, payload: res.payload, message: "Test mode: nothing was sent to Notion. This is exactly what would have been created. It's saved in the write log." }
  return { ok: true, url: res.page.url, message: "Action created in Notion." }
}

const Test = z.object({
  title: z.string().trim().min(1, "Say what we're testing.").max(200),
  hypothesis: z.string().trim().max(1000),
  success_text: z.string().trim().min(1, "Say what success looks like.").max(500),
  owner_notion_user_id: z.string().max(60).nullable(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  items: z.array(z.string().max(600)).max(500),
})

/** Make it a sprint test: a planned test in the current sprint, linked back to the insight. */
export async function testFromInsight(slug: string, key: string, raw: z.input<typeof Test>): Promise<InsightResult> {
  const p = Test.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  const l = await load(slug, key, p.data.items)
  if ("error" in l) return fail(l.error!)
  const me = await getProfile()
  const sprint = await ensureSprint(l.supabase, l.client.id, sprintOf(londonToday()))
  if (sprint.closed_at) return fail("This sprint is closed.")
  const owner = p.data.owner_notion_user_id ? (await peopleForClient(l.supabase, l.client.id)).find((x) => x.notionUserId === p.data.owner_notion_user_id) : null
  const i = l.insight
  const items = i.items.filter((x) => l.chosen.includes(x.id))
  const notes = [
    `From "Optimise now" (${RULES[i.rule].label})${i.campaignName ? `, campaign ${i.campaignName}` : ""}: ${i.why}`,
    `What to do: ${i.todo}`,
    items.length ? `${i.itemsLabel ?? "Items"}:\n${items.map((x) => `- ${x.label}${x.note ? ` (${x.note})` : ""}${x.campaigns?.length ? ` [seen in: ${x.campaigns.join("; ")}]` : ""}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")
  const { data: test, error } = await l.supabase
    .from("sprint_tests")
    .insert({
      sprint_id: sprint.id,
      client_id: l.client.id,
      platform: CONNECTED.includes(i.platform) ? i.platform : null,
      title: p.data.title,
      hypothesis: p.data.hypothesis || null,
      assets: [],
      brief_notes: notes.slice(0, 3000),
      success_text: p.data.success_text,
      owner_notion_user_id: owner?.notionUserId ?? null,
      owner_name: owner?.name ?? null,
      deadline: p.data.deadline,
      created_by_profile_id: me.id,
      campaign_ids: i.campaignId ? [i.campaignId] : [],
      insight_key: key,
    })
    .select("id")
    .single()
  if (error || !test) return fail("Couldn't create the test.")
  await l.supabase.from("insight_actions").insert({ client_id: l.client.id, insight_key: key, rule: i.rule, action: "tested", items: l.chosen, sprint_test_id: test.id, snapshot: snapshot(i, l.chosen) })
  refresh(slug)
  revalidatePath(`/clients/${slug}/sprint`)
  return { ok: true, message: `Planned in Sprint ${sprint.number}.`, url: `/clients/${slug}/sprint#test-${test.id}` }
}
