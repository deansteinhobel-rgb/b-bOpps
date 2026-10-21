"use server"

import { randomUUID } from "node:crypto"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile, isAdmin } from "@/lib/auth"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import { beforeOf, editStore, linkedInAccount, linkedInCampaignOf } from "@/lib/ads-api/edit-service"
import { runEdit, type Before, type CampaignChange, type EditResult } from "@/lib/ads-api/edit"
import { adsApiEditsEnabled, adsApiEnv, editDryRunReason } from "@/lib/ads-api/gates"
import { linkedInEditSender } from "@/lib/ads-api/linkedin"
import { accountOrganization, leadForms, matchedAudiences, readCampaign, targetingTypeahead, type MatchedAudience } from "@/lib/ads-api/linkedin-read"
import { saveCampaignBuild, sendCampaignBuild } from "@/lib/ads-api/service"
import type { Check } from "@/lib/ads-api/spec"
import type { RunResult } from "@/lib/ads-api/build"
import { GUARD_FIELDS, type CheckRule } from "@/lib/campaign-builder/guardrails"
import { FACETS, plan as planSchema, planToSpec, type Plan } from "@/lib/campaign-builder/plan-schema"
import { researchPlaybook, RESEARCH_PLATFORMS, type ResearchPlatform } from "@/lib/campaign-builder/research"
import { money } from "@/lib/format"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"

// Planning › Campaign builder (Dean, 2026-10-21). Every action checks who you are and that the
// client, account and campaign are this client's, on the server, from our own data.

const BUCKET = "campaign-assets"
const NOT_ALLOWED = "Only admins and GTM leads on this client can build campaigns for now."

async function clientFor(slug: string) {
  const me = await getProfile()
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, currency, website").eq("slug", slug).maybeSingle()
  if (!client) return { error: "This client isn't available to you." } as const
  if (!(await canBuildCampaigns(me, client.id))) return { error: NOT_ALLOWED } as const
  return { me, supabase, client, error: null } as const
}

const notConnected = (e: unknown) => {
  const m = (e as Error).message
  return /isn't connected|isn't set/.test(m) ? "LinkedIn isn't connected to Lumaux yet (pnpm ads:connect linkedin). The plan still works; ids are looked up once it is." : `LinkedIn: ${m}`
}

/** A signed upload link for one ad image, at <client_id>/<uuid>.<ext>. The browser uploads straight to storage. */
export async function imageUploadUrl(slug: string, contentType: string): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const c = await clientFor(slug)
  if (c.error) return { ok: false, error: c.error }
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" }[contentType]
  if (!ext) return { ok: false, error: "Use a JPG, PNG or GIF image." }
  const limited = await rateLimit(c.supabase, "build_image")
  if (limited) return { ok: false, error: limited }
  const path = `${c.client.id}/${randomUUID()}.${ext}`
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: "Couldn't prepare the upload." }
  return { ok: true, path, token: data.token }
}

/** A one-hour link to show an uploaded image, only for this client's own images. */
export async function imagePreview(slug: string, path: string): Promise<string | null> {
  const c = await clientFor(slug)
  if (c.error || !path.startsWith(`${c.client.id}/`)) return null
  const { data } = await createAdminClient().storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

/** LinkedIn's ids for a targeting value, by name (read only). */
export async function lookupTargeting(slug: string, facet: string, query: string): Promise<{ ok: true; results: { name: string; urn: string }[] } | { ok: false; error: string }> {
  const c = await clientFor(slug)
  if (c.error) return { ok: false, error: c.error }
  if (!(facet in FACETS) || facet === "audienceMatchingSegments") return { ok: false, error: "Look matched audiences up from the account's list." }
  if (query.trim().length < 2) return { ok: true, results: [] }
  const limited = await rateLimit(c.supabase, "targeting_lookup")
  if (limited) return { ok: false, error: limited }
  try {
    return { ok: true, results: await targetingTypeahead(facet, query.trim()) }
  } catch (e) {
    return { ok: false, error: notConnected(e) }
  }
}

/** The account's matched audiences (company and contact lists, retargeting), for ABX. */
export async function accountAudiences(slug: string, accountId: string): Promise<{ ok: true; audiences: MatchedAudience[] } | { ok: false; error: string }> {
  const c = await clientFor(slug)
  if (c.error) return { ok: false, error: c.error }
  if (!(await linkedInAccount(c.client.id, accountId))) return { ok: false, error: "That isn't one of this client's LinkedIn accounts." }
  try {
    return { ok: true, audiences: await matchedAudiences(accountId) }
  } catch (e) {
    return { ok: false, error: notConnected(e) }
  }
}

/** The account's lead gen forms, for lead gen builds. */
export async function accountLeadForms(slug: string, accountId: string): Promise<{ ok: true; forms: { name: string; urn: string; state: string }[] } | { ok: false; error: string }> {
  const c = await clientFor(slug)
  if (c.error) return { ok: false, error: c.error }
  if (!(await linkedInAccount(c.client.id, accountId))) return { ok: false, error: "That isn't one of this client's LinkedIn accounts." }
  try {
    return { ok: true, forms: await leadForms(accountId) }
  } catch (e) {
    return { ok: false, error: notConnected(e) }
  }
}

/** Saves the team's edits to a plan (copy, audience ids, images, budget). Checked against the plan's format. */
export async function savePlan(planId: string, raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const me = await getProfile()
  const supabase = await createClient()
  const { data: row } = await supabase.from("campaign_build_plans").select("id, client_id, campaign_build_id").eq("id", planId).maybeSingle()
  if (!row) return { ok: false, error: "This plan isn't available to you." }
  if (!(await canBuildCampaigns(me, row.client_id))) return { ok: false, error: NOT_ALLOWED }
  const parsed = planSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: `Check the plan: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` }
  for (const ad of parsed.data.ads) if (ad.imagePath && !ad.imagePath.startsWith(`${row.client_id}/`)) return { ok: false, error: "That image belongs to another client." }
  await createAdminClient(me.id).from("campaign_build_plans").update({ plan: toJson(parsed.data), updated_at: new Date().toISOString() }).eq("id", planId)
  return { ok: true }
}

/** A check as the browser gets it: the build's steps hold functions, which can't leave the server. */
const plainCheck = (c: Check | undefined): Check | undefined => (c ? { ok: c.ok, errors: c.errors, warnings: c.warnings } : undefined)

export type BuildOutcome = { ok: boolean; buildId?: string; check?: Check; run?: RunResult; leftOut: string[]; error?: string }

/**
 * Turns the reviewed plan into a build and runs it: a dry run unless every switch is on (gates.ts),
 * in which case the campaign is created PAUSED. Every check in service.ts runs again on the server.
 */
export async function buildFromPlan(planId: string, accountId: string): Promise<BuildOutcome> {
  const me = await getProfile()
  const supabase = await createClient()
  const { data: row } = await supabase.from("campaign_build_plans").select("id, client_id, mode, plan, sprint_test_id, clients(slug)").eq("id", planId).maybeSingle()
  if (!row) return { ok: false, leftOut: [], error: "This plan isn't available to you." }
  if (!(await canBuildCampaigns(me, row.client_id))) return { ok: false, leftOut: [], error: NOT_ALLOWED }
  if (!(await linkedInAccount(row.client_id, accountId))) return { ok: false, leftOut: [], error: "Pick one of this client's LinkedIn accounts." }
  const parsed = planSchema.safeParse(row.plan)
  if (!parsed.success) return { ok: false, leftOut: [], error: "Save a complete plan first." }

  // The company page the ads run as: LinkedIn says, once connected. Dry runs go ahead without it.
  const organizationId = await accountOrganization(accountId).catch(() => null)
  const { spec, leftOut } = planToSpec(parsed.data, organizationId ?? "0")
  if (!spec.ads.length) return { ok: false, leftOut, error: "No ad is ready to build yet: upload images, or pick the posts to sponsor." }

  const saved = await saveCampaignBuild(me, { clientId: row.client_id, platform: "linkedin", accountId, name: parsed.data.campaign.name, spec, sprintTestId: row.sprint_test_id, planId: row.id, mode: row.mode as "general" | "abx" })
  if (!saved.id) return { ok: false, leftOut, check: plainCheck(saved.check), error: saved.check.errors.join(" ") }
  if (!organizationId) saved.check.warnings.push("LinkedIn isn't connected yet, so the company page couldn't be read: the dry run uses a placeholder.")
  await createAdminClient(me.id).from("campaign_build_plans").update({ campaign_build_id: saved.id, updated_at: new Date().toISOString() }).eq("id", row.id)
  const run = organizationId || !isLive(row.clients?.slug ?? "") ? await sendCampaignBuild(me, saved.id) : undefined
  revalidatePath(`/clients/${row.clients?.slug}/build`)
  if (!run) return { ok: false, buildId: saved.id, check: plainCheck(saved.check), leftOut, error: "Couldn't read the company page from LinkedIn, so nothing was sent." }
  const { check: runCheck, ...result } = run
  return { ok: run.ok, buildId: saved.id, check: plainCheck({ ...saved.check, warnings: [...saved.check.warnings, ...(runCheck?.warnings ?? [])].filter((w, i, a) => a.indexOf(w) === i) }), run: result, leftOut, error: run.error }
}

const isLive = (slug: string) => {
  const env = adsApiEnv()
  return env.writesEnabled && !env.dryRun && env.platforms.includes("linkedin") && (!env.liveClients || env.liveClients.includes(slug))
}

/** Sends a saved build again (after a fix in the platform, or the first live run of a dry-run build). */
export async function sendBuild(buildId: string): Promise<RunResult & { check?: Check }> {
  const me = await getProfile()
  const { check, ...run } = await sendCampaignBuild(me, buildId)
  return { ...run, check: plainCheck(check) }
}

// ── Edits to live campaigns ──────────────────────────────────────────────────────────────────────

export type LiveCampaignInfo = { ok: true; before: Before; live: boolean; reason: string | null } | { ok: false; error: string }

/** The campaign as LinkedIn has it now (the "before" the edit dialog shows), and whether edits are live. */
export async function liveCampaign(slug: string, campaignId: string): Promise<LiveCampaignInfo> {
  const c = await clientFor(slug)
  if (c.error) return { ok: false, error: c.error }
  const campaign = await linkedInCampaignOf(c.client.id, campaignId)
  if (!campaign) return { ok: false, error: "That isn't one of this client's LinkedIn campaigns." }
  const reason = editDryRunReason({ ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }, "linkedin", c.client.slug)
  try {
    const r = await readCampaign(campaign.accountId, campaignId)
    return { ok: true, before: beforeOf(r), live: reason === null, reason }
  } catch (e) {
    // Dry runs still work without LinkedIn: the before is unknown.
    const m = (e as Error).message
    return { ok: true, before: null, live: false, reason: /isn't connected|isn't set/.test(m) ? "LinkedIn isn't connected to Lumaux yet, so the campaign's current values can't be shown." : `LinkedIn: ${m}` }
  }
}

const Change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("update"), dailyBudget: z.number().positive().max(1_000_000).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), name: z.string().max(255).optional() }),
])

/** Pause, or change the daily budget, end date or name of a LinkedIn campaign. Logged with the value before. */
export async function editLiveCampaign(slug: string, campaignId: string, raw: CampaignChange): Promise<EditResult> {
  const fail = (error: string): EditResult => ({ ok: false, live: false, lines: [], error })
  const parsed = Change.safeParse(raw)
  if (!parsed.success) return fail("Check the change.")
  const c = await clientFor(slug)
  if (c.error) return fail(c.error)
  const campaign = await linkedInCampaignOf(c.client.id, campaignId)
  if (!campaign) return fail("That isn't one of this client's LinkedIn campaigns.")
  const limited = await rateLimit(c.supabase, "campaign_edit")
  if (limited) return fail(limited)

  const env = { ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }
  const live = editDryRunReason(env, "linkedin", c.client.slug) === null
  let before: Before = null
  try {
    const r = await readCampaign(campaign.accountId, campaignId)
    before = beforeOf(r)
  } catch (e) {
    // Live edits need the value before; dry runs log without it.
    if (live) return fail(`Couldn't read the campaign from LinkedIn first, so nothing was sent. ${notConnected(e)}`)
  }

  // The budget guard: a new daily budget can't add up to more than the month's LinkedIn budget.
  const change = parsed.data
  if (change.kind === "update" && change.dailyBudget !== undefined) {
    const month = `${new Date().toISOString().slice(0, 7)}-01`
    const { data: budget } = await createAdminClient().from("client_budgets").select("amount").eq("client_id", c.client.id).eq("platform", "linkedin").eq("month", month).eq("campaign_id", "").maybeSingle()
    if (budget && change.dailyBudget * 30 > Number(budget.amount)) return fail(`A daily budget of ${money(change.dailyBudget, c.client.currency)} adds up to more than this month's LinkedIn budget of ${money(Number(budget.amount), c.client.currency)}.`)
  }

  const db = createAdminClient(c.me.id)
  const result = await runEdit(
    {
      env,
      sender: live ? linkedInEditSender() : null,
      store: editStore(db),
    },
    { by: c.me.id, client: { id: c.client.id, slug: c.client.slug }, accountId: campaign.accountId, campaignId, currency: c.client.currency, change, before, money: (n) => money(n, c.client.currency) },
  )
  revalidatePath(`/clients/${slug}/build`)
  return result
}

// ── The playbook ─────────────────────────────────────────────────────────────────────────────────

const Rule = z.object({
  kind: z.enum(["guardrail", "practice", "naming"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000).default(""),
  modes: z.array(z.enum(["general", "abx"])).min(1).default(["general", "abx"]),
  allClients: z.boolean().default(false),
  check: z
    .object({ field: z.enum(Object.keys(GUARD_FIELDS) as [keyof typeof GUARD_FIELDS]), op: z.enum(["max", "min", "forbid", "require"]), value: z.union([z.number(), z.string().max(80)]).optional() })
    .nullable()
    .default(null),
})

/** Adds a rule: for this client (its team), or for every client (admins). Through RLS, so the change log records who. */
export async function addRule(slug: string, raw: z.input<typeof Rule>): Promise<{ ok: boolean; error?: string }> {
  const me = await getProfile()
  const parsed = Rule.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "A rule needs a title." }
  const r = parsed.data
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) return { ok: false, error: "This client isn't available to you." }
  if (r.allClients && !isAdmin(me)) return { ok: false, error: "Only admins and GTM leads add rules for every client." }
  const { error } = await supabase.from("ad_playbook_rules").insert({
    platform: "linkedin",
    client_id: r.allClients ? null : client.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    modes: r.modes,
    check_rule: r.kind === "guardrail" && r.check ? toJson(r.check satisfies CheckRule) : null,
    created_by: me.id,
  })
  if (error) return { ok: false, error: "You can't add rules here." }
  revalidatePath(`/clients/${slug}/build`)
  return { ok: true }
}

/** Removes a rule (soft: it stays in the table and the change log). */
export async function removeRule(slug: string, ruleId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getProfile()
  const supabase = await createClient()
  const { data, error } = await supabase.from("ad_playbook_rules").update({ removed_at: new Date().toISOString(), removed_by: me.id, updated_at: new Date().toISOString() }).eq("id", ruleId).is("removed_at", null).select("id")
  if (error || !data?.length) return { ok: false, error: "You can't change that rule." }
  revalidatePath(`/clients/${slug}/build`)
  return { ok: true }
}

/** Runs the playbook research now instead of waiting for the 1st (admins; a few minutes, in the background). */
export async function researchNow(slug: string, platform: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getProfile()
  if (!isAdmin(me)) return { ok: false, error: "Only admins and GTM leads run the research by hand." }
  if (!(RESEARCH_PLATFORMS as readonly string[]).includes(platform)) return { ok: false, error: "Unknown platform." }
  const limited = await rateLimit(await createClient(), "playbook_research")
  if (limited) return { ok: false, error: limited }
  after(async () => {
    await researchPlaybook(platform as ResearchPlatform, { requestedBy: me.id }).catch((e) => console.error("[playbook] research failed", e))
    revalidatePath(`/clients/${slug}/build`)
  })
  return { ok: true }
}

export type { Plan }
