"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import { adsApiEditsEnabled, adsApiEnv, editDryRunReason } from "@/lib/ads-api/gates"
import type { PlatformChange } from "@/lib/ads-api/platform-edit"
import { applyEdit, campaignOf, monthBudget, previewEdit, readBefore } from "@/lib/ads-api/platform-edit-service"
import { loadFeed } from "@/lib/insights/feed"
import { money } from "@/lib/format"
import { platformFixFor, type PlatformFix } from "@/lib/platform-links"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"

// Recommendations › changes in Google Ads and Meta (Dean, 2026-10-21), through the platform edits
// (platform-edit.ts): converting search terms added as keywords (exact match by default, in the ad
// group each term came from), a budget-capped campaign's daily budget, and Meta's urgent settings
// fixed on each ad set (Audience Network off, Advantage+ audience off). Each change is read first,
// logged with the value before, and sent only with the edit switches on.

const NOT_ALLOWED = "Only admins and GTM leads on this client can change campaigns in the platforms for now."

async function context(slug: string, key: string, want: PlatformFix) {
  const me = await getProfile()
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, currency").eq("slug", slug).maybeSingle()
  if (!client) return { error: "This client isn't available to you." } as const
  if (!(await canBuildCampaigns(me, client.id))) return { error: NOT_ALLOWED } as const
  const insight = (await loadFeed(supabase, client.id))?.insights.find((i) => i.key === key)
  if (!insight) return { error: "This recommendation has gone: the numbers changed since the page loaded." } as const
  if (platformFixFor(insight.rule, insight.platform) !== want) return { error: "This recommendation can't make that change." } as const
  const platform = insight.platform as "google_ads" | "meta"
  const reason = editDryRunReason({ ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }, platform, client.slug)
  return { me, supabase, client, insight, platform, reason, error: null } as const
}

export type FixRow = { name: string; campaignId: string; change?: PlatformChange; lines: string[]; error?: string }
export type FixPlan = { ok: true; live: boolean; reason: string | null; rows: FixRow[]; current?: number | null; suggested?: number; max?: number | null } | { ok: false; error: string }
export type FixResult = { ok: boolean; live: boolean; message: string; details: { name: string; ok: boolean; lines?: string[]; error?: string }[] }

/** Marks the recommendation done after a live change (a dry run leaves it open). */
async function markDone(c: { supabase: Awaited<ReturnType<typeof createClient>>; client: { id: string }; insight: { key: string; rule: string; title: string; why: string; numbers: unknown; campaignName: string | null } }, items: string[], note: string) {
  await c.supabase.from("insight_actions").insert({
    client_id: c.client.id,
    insight_key: c.insight.key,
    rule: c.insight.rule,
    action: "done",
    items,
    note,
    snapshot: toJson({ title: c.insight.title, why: c.insight.why, numbers: c.insight.numbers, campaign: c.insight.campaignName }),
  })
}

// ── Google: converting search terms → keywords ──────────────────────────────────────────────────

const Terms = z.array(z.string().min(1).max(200)).min(1).max(500)
const Match = z.enum(["EXACT", "PHRASE"])

/** Each term's ad group (the one it converted in most, last 90 days), from our own data. */
async function adGroupsFor(clientId: string, campaignId: string, terms: string[]) {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  const { data } = await createAdminClient()
    .from("windsor_breakdowns")
    .select("dim1, group_id, group_name, conversions")
    .eq("client_id", clientId)
    .eq("kind", "search_term")
    .eq("campaign_id", campaignId)
    .in("dim1", terms)
    .gte("date", since)
    .limit(5000)
  const best = new Map<string, { id: string; name: string; conv: number }>()
  const sums = new Map<string, number>()
  for (const r of data ?? []) {
    if (!/^\d+$/.test(r.group_id)) continue
    const k = `${r.dim1}\u0000${r.group_id}`
    sums.set(k, (sums.get(k) ?? 0) + Number(r.conversions))
    const total = sums.get(k)!
    const now = best.get(r.dim1)
    if (!now || total > now.conv) best.set(r.dim1, { id: r.group_id, name: r.group_name ?? r.group_id, conv: total })
  }
  const groups = new Map<string, { name: string; terms: string[] }>()
  const missing: string[] = []
  for (const t of terms) {
    const g = best.get(t)
    if (!g) missing.push(t)
    else groups.set(g.id, { name: g.name, terms: [...(groups.get(g.id)?.terms ?? []), t] })
  }
  return { groups, missing }
}

async function keywordRows(c: { client: { id: string }; insight: { campaignId: string | null; items: { id: string }[] } }, rawTerms: string[], match: "EXACT" | "PHRASE") {
  const listed = new Set(c.insight.items.map((x) => x.id))
  const terms = rawTerms.filter((t) => listed.has(t))
  if (!terms.length || !c.insight.campaignId) return { error: "Pick search terms from this recommendation." } as const
  const { groups, missing } = await adGroupsFor(c.client.id, c.insight.campaignId, terms)
  return { campaignId: c.insight.campaignId, rows: [...groups.entries()].map(([id, g]) => ({ id, name: g.name, change: { kind: "keywords", adGroupId: id, adGroupName: g.name, keywords: g.terms.map((text) => ({ text, match })) } as PlatformChange })), missing, error: null } as const
}

export async function planKeywordsFromInsight(slug: string, key: string, rawTerms: string[], rawMatch: "EXACT" | "PHRASE" = "EXACT"): Promise<FixPlan> {
  const parsed = Terms.safeParse(rawTerms)
  const match = Match.safeParse(rawMatch)
  if (!parsed.success || !match.success) return { ok: false, error: "Pick the search terms to add." }
  const c = await context(slug, key, "keywords")
  if (c.error) return { ok: false, error: c.error }
  const k = await keywordRows(c, parsed.data, match.data)
  if (k.error) return { ok: false, error: k.error }
  if (!(await campaignOf(c.client.id, "google_ads", k.campaignId))) return { ok: false, error: "That isn't one of this client's Google Ads campaigns." }
  const rows: FixRow[] = [
    ...k.rows.map((r) => {
      const ch = r.change as Extract<PlatformChange, { kind: "keywords" }>
      return { name: r.name, campaignId: k.campaignId, change: r.change, lines: [`+ ${ch.keywords.map((x) => (x.match === "EXACT" ? `[${x.text}]` : `"${x.text}"`)).join(", ")}`] }
    }),
    ...k.missing.map((t) => ({ name: t, campaignId: k.campaignId, lines: [], error: "Lumaux doesn't know which ad group this term came from. Add it in Google Ads." })),
  ]
  return { ok: true, live: c.reason === null, reason: c.reason, rows }
}

export async function keywordsFromInsight(slug: string, key: string, rawTerms: string[], rawMatch: "EXACT" | "PHRASE" = "EXACT"): Promise<FixResult> {
  const fail = (message: string): FixResult => ({ ok: false, live: false, message, details: [] })
  const parsed = Terms.safeParse(rawTerms)
  const match = Match.safeParse(rawMatch)
  if (!parsed.success || !match.success) return fail("Pick the search terms to add.")
  const c = await context(slug, key, "keywords")
  if (c.error) return fail(c.error)
  const k = await keywordRows(c, parsed.data, match.data)
  if (k.error) return fail(k.error)
  const details: FixResult["details"] = []
  let live = false
  for (const r of k.rows) {
    const out = await applyEdit(c.me, c.client, "google_ads", k.campaignId, r.change)
    live ||= out.live
    details.push({ name: r.name, ok: out.ok, lines: out.lines, error: out.error })
  }
  const ok = details.length > 0 && details.every((d) => d.ok)
  if (ok && live) {
    await markDone(c, parsed.data, "Added as keywords in Google Ads from Lumaux")
    revalidatePath(`/clients/${slug}/insights`)
  }
  return { ok, live, message: !ok ? "Not every ad group took the keywords: see below." : live ? "Added in Google Ads." : `Dry run: logged, nothing was sent. ${c.reason ?? ""}`.trim(), details }
}

// ── Google: a budget-capped campaign's daily budget ─────────────────────────────────────────────

/** The current daily budget (read through Windsor) and a suggestion: 20% more, within the month's budget. */
export async function planBudgetFromInsight(slug: string, key: string): Promise<FixPlan> {
  const c = await context(slug, key, "budget")
  if (c.error) return { ok: false, error: c.error }
  const campaignId = c.insight.campaignId
  const campaign = campaignId ? await campaignOf(c.client.id, "google_ads", campaignId) : null
  if (!campaign || !campaignId) return { ok: false, error: "That isn't one of this client's Google Ads campaigns." }
  const current = await readBefore("google_ads", campaign.connector, campaign.accountId, campaignId).then((b) => b.dailyBudget).catch(() => null)
  const month = await monthBudget(c.client.id, "google_ads")
  const max = month !== null ? Math.floor(month / 30) : null
  const suggested = current ? Math.round(Math.min(current * 1.2, max ?? Infinity)) : (max ?? 0)
  return { ok: true, live: c.reason === null && current !== null, reason: current === null ? "Couldn't read the budget from Windsor: this would only be logged." : c.reason, rows: [{ name: campaign.name, campaignId, change: { kind: "budget", dailyBudget: suggested }, lines: [`Daily budget: ${current !== null ? money(current, c.client.currency) : "unknown"} → ${money(suggested, c.client.currency)}`] }], current, suggested, max }
}

export async function budgetFromInsight(slug: string, key: string, dailyBudget: number): Promise<FixResult> {
  const fail = (message: string): FixResult => ({ ok: false, live: false, message, details: [] })
  if (!(dailyBudget > 0 && dailyBudget < 1_000_000)) return fail("Enter a daily budget above 0.")
  const c = await context(slug, key, "budget")
  if (c.error) return fail(c.error)
  if (!c.insight.campaignId) return fail("This recommendation has no campaign.")
  const r = await applyEdit(c.me, c.client, "google_ads", c.insight.campaignId, { kind: "budget", dailyBudget })
  if (r.ok && r.live) {
    await markDone(c, [], "Daily budget raised in Google Ads from Lumaux")
    revalidatePath(`/clients/${slug}/insights`)
  }
  return { ok: r.ok, live: r.live, message: !r.ok ? (r.error ?? "Google Ads didn't take the change.") : r.live ? "Budget changed in Google Ads." : `Dry run: logged, nothing was sent. ${c.reason ?? ""}`.trim(), details: [{ name: c.insight.campaignName ?? "The campaign", ok: r.ok, lines: r.lines, error: r.error }] }
}

// ── Meta: urgent settings fixed on each ad set ──────────────────────────────────────────────────

const AdSets = z.array(z.string().regex(/^\d+$/)).min(1).max(50)

/** The ad sets the recommendation lists, with their campaigns, from our own settings check. */
async function metaAdSets(clientId: string, ids: string[], listed: Set<string>) {
  const want = ids.filter((id) => listed.has(id))
  if (!want.length) return []
  const { data } = await createAdminClient().from("platform_settings").select("entity_id, entity_name, campaign_id").eq("client_id", clientId).eq("platform", "meta").eq("level", "adset").in("entity_id", want)
  return (data ?? []).map((r) => ({ id: r.entity_id, name: r.entity_name ?? r.entity_id, campaignId: r.campaign_id }))
}

export async function planMetaFixFromInsight(slug: string, key: string, rawIds: string[]): Promise<FixPlan> {
  const ids = AdSets.safeParse(rawIds)
  if (!ids.success) return { ok: false, error: "Pick the ad sets to change." }
  const first = await getFixKind(slug, key)
  if ("error" in first) return { ok: false, error: first.error }
  const c = await context(slug, key, first.fix)
  if (c.error) return { ok: false, error: c.error }
  const sets = await metaAdSets(c.client.id, ids.data, new Set(c.insight.items.map((x) => x.id)))
  if (!sets.length) return { ok: false, error: "Pick ad sets from this recommendation." }
  const rows: FixRow[] = []
  let live = c.reason === null
  for (const s of sets) {
    const change: PlatformChange = { kind: "targeting", adSetId: s.id, fix: first.fix as "audience_network_off" | "advantage_off" }
    const p = await previewEdit(c.client, "meta", s.campaignId, change)
    if (!p.ok) rows.push({ name: s.name, campaignId: s.campaignId, change, lines: [], error: p.error })
    else {
      live &&= p.live
      rows.push({ name: s.name, campaignId: s.campaignId, change, lines: p.lines.map((l) => l.replace(`${s.name}: `, "")) })
    }
  }
  return { ok: true, live, reason: live ? null : (c.reason ?? "Couldn't read every ad set's targeting from Windsor: this would only be logged."), rows }
}

export async function metaFixFromInsight(slug: string, key: string, rawIds: string[]): Promise<FixResult> {
  const fail = (message: string): FixResult => ({ ok: false, live: false, message, details: [] })
  const ids = AdSets.safeParse(rawIds)
  if (!ids.success) return fail("Pick the ad sets to change.")
  const first = await getFixKind(slug, key)
  if ("error" in first) return fail(first.error)
  const c = await context(slug, key, first.fix)
  if (c.error) return fail(c.error)
  const sets = await metaAdSets(c.client.id, ids.data, new Set(c.insight.items.map((x) => x.id)))
  if (!sets.length) return fail("Pick ad sets from this recommendation.")
  const details: FixResult["details"] = []
  let live = false
  for (const s of sets) {
    const r = await applyEdit(c.me, c.client, "meta", s.campaignId, { kind: "targeting", adSetId: s.id, fix: first.fix as "audience_network_off" | "advantage_off" })
    live ||= r.live
    details.push({ name: s.name, ok: r.ok, lines: r.lines.map((l) => l.replace(`${s.name}: `, "")), error: r.error })
  }
  const ok = details.every((d) => d.ok)
  if (ok && live) {
    await markDone(c, sets.map((s) => s.id), first.fix === "audience_network_off" ? "Audience Network turned off in Meta from Lumaux" : "Advantage+ audience turned off in Meta from Lumaux")
    revalidatePath(`/clients/${slug}/insights`)
  }
  return { ok, live, message: !ok ? "Not every ad set took the change: see below." : live ? "Changed in Meta." : `Dry run: logged, nothing was sent. ${c.reason ?? ""}`.trim(), details }
}

/** Which Meta fix a settings recommendation makes, from its rule (read on the server, not from the browser). */
async function getFixKind(slug: string, key: string): Promise<{ fix: PlatformFix } | { error: string }> {
  const fix = key.startsWith("settings_audience_network:") ? "audience_network_off" : key.startsWith("settings_advantage:") ? "advantage_off" : null
  return fix ? { fix } : { error: "This recommendation can't make that change." }
}
