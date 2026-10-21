"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import type { RunResult } from "@/lib/ads-api/build"
import type { PlatformChange, PlatformEditResult } from "@/lib/ads-api/platform-edit"
import { applyEdit, platformAccount, previewEdit, type EditPreview } from "@/lib/ads-api/platform-edit-service"
import { saveCampaignBuild, sendCampaignBuild } from "@/lib/ads-api/service"
import type { Check } from "@/lib/ads-api/spec"
import { draftName, draftToSpec, platformPlan, type OtherPlatform, type PlatformPlan } from "@/lib/campaign-builder/platform-plan"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"
import { readMetaAccount, type MetaAccountRead } from "@/lib/ads-api/meta-account"
import type { MetaConversion } from "@/lib/ads-api/meta-ids"

// Planning › Campaign builder for Google Ads, Meta, Reddit and Microsoft Ads (Dean, 2026-10-21).
// Every action checks who you are, and that the client, account and campaign are this client's,
// on the server, from our own data. LinkedIn's actions are in actions.ts.

const NOT_ALLOWED = "Only admins and GTM leads on this client can build or change campaigns for now."
const OTHER = z.enum(["google_ads", "meta", "reddit", "microsoft_ads"])

async function clientFor(slug: string) {
  const me = await getProfile()
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, currency, website").eq("slug", slug).maybeSingle()
  if (!client) return { error: "This client isn't available to you." } as const
  if (!(await canBuildCampaigns(me, client.id))) return { error: NOT_ALLOWED } as const
  return { me, supabase, client, error: null } as const
}

/** A check as the browser gets it: the build's steps hold functions, which can't leave the server. */
const plainCheck = (c: Check | undefined): Check | undefined => (c ? { ok: c.ok, errors: c.errors, warnings: c.warnings } : undefined)

/** The plan row, when it's this client's and for this plan's platform. */
async function planRow(slug: string, planId: string, plan: unknown) {
  const c = await clientFor(slug)
  if (c.error) return { error: c.error } as const
  const parsed = platformPlan.safeParse(plan)
  if (!parsed.success) return { error: `Check the plan: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` } as const
  const { data: row } = await c.supabase.from("campaign_build_plans").select("id, client_id, platform, mode, sprint_test_id").eq("id", planId).eq("client_id", c.client.id).maybeSingle()
  if (!row) return { error: "This plan isn't available to you." } as const
  if (row.platform !== parsed.data.platform) return { error: "This plan is for another platform." } as const
  // Images must be this client's own uploads.
  if (parsed.data.platform === "meta" && parsed.data.draft.ads.some((a) => a.imagePath && !a.imagePath.startsWith(`${c.client.id}/`))) return { error: "That image belongs to another client." } as const
  return { ...c, row, plan: parsed.data, error: null } as const
}

/** Saves the team's edits to a plan. Checked against the plan's format. */
export async function savePlatformPlan(slug: string, planId: string, plan: PlatformPlan): Promise<{ ok: boolean; error?: string }> {
  const r = await planRow(slug, planId, plan)
  if (r.error) return { ok: false, error: r.error }
  await createAdminClient(r.me.id).from("campaign_build_plans").update({ plan: toJson(r.plan), updated_at: new Date().toISOString() }).eq("id", planId)
  return { ok: true }
}

export type PlatformBuildOutcome = { ok: boolean; buildId?: string; check?: Check; run?: RunResult; missing: string[]; leftOut: string[]; error?: string }

/**
 * Saves the reviewed plan, turns it into a build and runs it: a dry run unless every switch is on
 * (gates.ts) AND the person pressed "Build paused in …" (`live`). Everything is created paused.
 */
export async function buildFromPlatformPlan(slug: string, planId: string, plan: PlatformPlan, accountId: string, live: boolean): Promise<PlatformBuildOutcome> {
  const r = await planRow(slug, planId, plan)
  if (r.error) return { ok: false, missing: [], leftOut: [], error: r.error }
  const platform = r.plan.platform
  if (!(await platformAccount(r.client.id, platform, accountId))) return { ok: false, missing: [], leftOut: [], error: platform === "microsoft_ads" ? "No Microsoft Ads account is mapped for this client yet." : "Pick one of this client's accounts on this platform." }
  const db = createAdminClient(r.me.id)
  await db.from("campaign_build_plans").update({ plan: toJson(r.plan), updated_at: new Date().toISOString() }).eq("id", planId)

  const { spec, missing, leftOut } = draftToSpec(r.plan)
  if (!spec) return { ok: false, missing, leftOut, error: "The plan isn't ready to build yet." }
  const saved = await saveCampaignBuild(r.me, { clientId: r.client.id, platform, accountId, name: draftName(r.plan), spec, sprintTestId: r.row.sprint_test_id, planId, mode: r.row.mode as "general" | "abx" })
  if (!saved.id) return { ok: false, missing, leftOut, check: plainCheck(saved.check), error: saved.check.errors.join(" ") }
  await db.from("campaign_build_plans").update({ campaign_build_id: saved.id, updated_at: new Date().toISOString() }).eq("id", planId)
  const { check: runCheck, ...run } = await sendCampaignBuild(r.me, saved.id, { dryRun: !live })
  revalidatePath(`/clients/${slug}/build`)
  const warnings = [...saved.check.warnings, ...(runCheck?.warnings ?? [])].filter((w, i, a) => a.indexOf(w) === i)
  return { ok: run.ok, buildId: saved.id, check: plainCheck({ ...saved.check, warnings }), run, missing, leftOut, error: run.error }
}

export type PlatformCampaign = { id: string; name: string; status: string | null; accountId: string; spend30: number; results30: number; adSets?: { id: string; name: string; status: string | null }[] }

/** The client's campaigns on a platform, from our own data: status, last 30 days' spend and results, Meta's ad sets. */
export async function platformCampaigns(slug: string, platform: OtherPlatform): Promise<PlatformCampaign[]> {
  const c = await clientFor(slug)
  if (c.error || !OTHER.safeParse(platform).success || platform === "microsoft_ads") return []
  const db = createAdminClient()
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const [{ data: statuses }, { data: metrics }, { data: adSets }, { data: accounts }] = await Promise.all([
    db.from("campaign_statuses").select("campaign_id, campaign_name, status, external_account_id").eq("client_id", c.client.id).eq("platform", platform),
    db.from("windsor_daily_metrics").select("campaign_id, campaign_name, external_account_id, spend, conversions, leads").eq("client_id", c.client.id).eq("platform", platform).gte("date", since).limit(20000),
    platform === "meta" ? db.from("platform_settings").select("entity_id, entity_name, campaign_id").eq("client_id", c.client.id).eq("platform", "meta").eq("level", "adset") : Promise.resolve({ data: [] as { entity_id: string; entity_name: string | null; campaign_id: string }[] }),
    db.from("client_platform_accounts").select("external_account_id").eq("client_id", c.client.id).eq("platform", platform).eq("active", true),
  ])
  const mapped = new Set((accounts ?? []).map((a) => a.external_account_id))
  const out = new Map<string, PlatformCampaign>()
  for (const s of statuses ?? []) if (mapped.has(s.external_account_id)) out.set(s.campaign_id, { id: s.campaign_id, name: s.campaign_name ?? s.campaign_id, status: s.status, accountId: s.external_account_id, spend30: 0, results30: 0 })
  for (const m of metrics ?? []) {
    if (!mapped.has(m.external_account_id) || !m.campaign_id) continue
    const row = out.get(m.campaign_id) ?? { id: m.campaign_id, name: m.campaign_name ?? m.campaign_id, status: null, accountId: m.external_account_id, spend30: 0, results30: 0 }
    row.spend30 += Number(m.spend) || 0
    row.results30 += (Number(m.conversions) || 0) + (Number(m.leads) || 0)
    out.set(m.campaign_id, row)
  }
  for (const a of adSets ?? []) {
    const row = out.get(a.campaign_id)
    if (row) row.adSets = [...(row.adSets ?? []), { id: a.entity_id, name: a.entity_name ?? a.entity_id, status: null }]
  }
  return [...out.values()].sort((a, b) => b.spend30 - a.spend30 || a.name.localeCompare(b.name))
}

const Change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("budget"), dailyBudget: z.number().positive().max(1_000_000), adSetId: z.string().regex(/^\d+$/).optional() }),
  z.object({ kind: z.literal("rename"), name: z.string().max(255) }),
  z.object({ kind: z.literal("pause_ad_set"), adSetId: z.string().regex(/^\d+$/) }),
  z.object({ kind: z.literal("ad_set_end"), adSetId: z.string().regex(/^\d+$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ kind: z.literal("targeting"), adSetId: z.string().regex(/^\d+$/), fix: z.enum(["audience_network_off", "advantage_off", "ages"]), ageMin: z.number().int().min(18).max(65).optional(), ageMax: z.number().int().min(18).max(65).optional() }),
  z.object({ kind: z.literal("keywords"), adGroupId: z.string().regex(/^\d+$/), adGroupName: z.string().max(255).optional(), keywords: z.array(z.object({ text: z.string().min(1).max(80), match: z.enum(["EXACT", "PHRASE"]) })).min(1).max(500) }),
])

export type EditPreviewResult = { ok: boolean; live: boolean; lines: string[]; error?: string; name?: string; reason?: string | null }

/** What an edit would change (before → after), read from the platform through Windsor first. Sends nothing. */
export async function previewPlatformEdit(slug: string, platform: OtherPlatform, campaignId: string, change: PlatformChange): Promise<EditPreviewResult> {
  const parsed = Change.safeParse(change)
  if (!parsed.success || !OTHER.safeParse(platform).success) return { ok: false, live: false, lines: [], error: "Check the change." }
  const c = await clientFor(slug)
  if (c.error) return { ok: false, live: false, lines: [], error: c.error }
  const p: EditPreview = await previewEdit(c.client, platform, campaignId, parsed.data)
  return p.ok ? { ok: true, live: p.live, lines: p.lines, name: p.name, reason: p.reason } : { ok: false, live: false, lines: [], error: p.error }
}

/** Makes the edit (dry run until the edit switches are on). Logged with the value before. */
export async function applyPlatformEdit(slug: string, platform: OtherPlatform, campaignId: string, change: PlatformChange): Promise<PlatformEditResult> {
  const parsed = Change.safeParse(change)
  if (!parsed.success || !OTHER.safeParse(platform).success) return { ok: false, live: false, lines: [], error: "Check the change." }
  const c = await clientFor(slug)
  if (c.error) return { ok: false, live: false, lines: [], error: c.error }
  const r = await applyEdit(c.me, c.client, platform, campaignId, parsed.data)
  revalidatePath(`/clients/${slug}/build`)
  return r
}

export type MetaAssets =
  | { pages: { id: string; name?: string }[]; conversions: MetaConversion[]; adSets: { id: string; name: string; campaign: string; summary: string; customAudiences: { id: string; name: string }[] }[] }
  | { error: string }

/**
 * What a Meta build can use from the account, read from Windsor (read only): the pages and pixels
 * its ad sets already use, and its ad sets with their audiences, to copy one's targeting.
 */
export async function metaAccountAssets(slug: string, accountId: string): Promise<MetaAssets> {
  const c = await clientFor(slug)
  if (c.error) return { error: c.error }
  const account = await platformAccount(c.client.id, "meta", accountId)
  if (!account) return { error: "That isn't one of this client's Meta accounts." }
  const limited = await rateLimit(c.supabase, "targeting_lookup")
  if (limited) return { error: limited }
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  let read: MetaAccountRead
  try {
    read = await readMetaAccount(account.connector, accountId, from, to)
  } catch (e) {
    return { error: `Couldn't read the account from Windsor: ${(e as Error).message}` }
  }
  const audiencesOf = (t: Record<string, unknown> | null, key: string) =>
    (Array.isArray(t?.[key]) ? (t[key] as { id?: unknown; name?: unknown }[]) : []).filter((x) => x?.id).map((x) => ({ id: String(x.id), name: String(x.name ?? x.id) }))
  const summary = (t: Record<string, unknown> | null) => {
    if (!t) return "Targeting not read"
    const geo = (t.geo_locations ?? {}) as { countries?: string[] }
    const parts = [geo.countries?.length ? geo.countries.join(", ") : "Custom locations", `ages ${t.age_min ?? 18}-${t.age_max ?? 65}`]
    const custom = audiencesOf(t, "custom_audiences").length
    if (custom) parts.push(`${custom} custom audience${custom === 1 ? "" : "s"}`)
    const excluded = audiencesOf(t, "excluded_custom_audiences").length
    if (excluded) parts.push(`${excluded} excluded`)
    if (Array.isArray(t.flexible_spec) && t.flexible_spec.length) parts.push("interests")
    return parts.join(" · ")
  }
  return {
    pages: read.pages.map((id) => ({ id })),
    conversions: read.conversions,
    adSets: read.adSets
      .filter((a) => a.targeting)
      .slice(0, 40)
      .map((a) => ({ id: a.id, name: a.name, campaign: a.campaign, summary: summary(a.targeting), customAudiences: audiencesOf(a.targeting, "custom_audiences") })),
  }
}
