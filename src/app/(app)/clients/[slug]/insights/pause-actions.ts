"use server"

import { revalidatePath } from "next/cache"
import { getProfile } from "@/lib/auth"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import { runEdit, type Before } from "@/lib/ads-api/edit"
import { beforeOf, editStore, linkedInCampaignOf, linkedInNotConnected } from "@/lib/ads-api/edit-service"
import { adsApiEditsEnabled, adsApiEnv, editDryRunReason } from "@/lib/ads-api/gates"
import { linkedInEditSender } from "@/lib/ads-api/linkedin"
import { readCampaign } from "@/lib/ads-api/linkedin-read"
import { applyEdit, previewEdit } from "@/lib/ads-api/platform-edit-service"
import type { EditPlatform } from "@/lib/ads-api/platform-edit"
import { loadFeed } from "@/lib/insights/feed"
import { canOfferPause, PLATFORM_NAME } from "@/lib/platform-links"
import { money } from "@/lib/format"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"

// Recommendations › "Pause in <platform>" (Dean, 2026-10-21): pause the campaign behind a cost per
// result or no-results recommendation. LinkedIn: the builder's Pause (status read from LinkedIn).
// Google Ads, Meta and Reddit: the platform edits (platform-edit.ts; status read through Windsor).
// Logged in platform_write_log with the value before, sent only with the edit switches on, and only
// ever to paused. Turning it back on is done in the platform.

const NOT_ALLOWED = "Only admins and GTM leads on this client can change campaigns in the platforms for now."

async function context(slug: string, key: string) {
  const me = await getProfile()
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, currency").eq("slug", slug).maybeSingle()
  if (!client) return { error: "This client isn't available to you." } as const
  if (!(await canBuildCampaigns(me, client.id))) return { error: NOT_ALLOWED } as const
  const insight = (await loadFeed(supabase, client.id))?.insights.find((i) => i.key === key)
  if (!insight) return { error: "This recommendation has gone: the numbers changed since the page loaded." } as const
  if (!canOfferPause(insight.rule, insight.platform, insight.campaignId)) return { error: "This recommendation can't pause a campaign." } as const
  return { me, supabase, client, insight, error: null } as const
}

async function linkedInContext(slug: string, key: string) {
  const c = await context(slug, key)
  if (c.error) return c
  const campaign = await linkedInCampaignOf(c.client.id, c.insight.campaignId!)
  if (!campaign) return { error: "That isn't one of this client's LinkedIn campaigns." } as const
  const env = { ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }
  return { ...c, campaign, env, reason: editDryRunReason(env, "linkedin", c.client.slug), error: null } as const
}

export type PausePlan = { ok: true; name: string; status: string | null; live: boolean; reason: string | null } | { ok: false; error: string }
export type PauseResult = { ok: boolean; live: boolean; message: string; lines: string[] }

/** What the pause would change: the campaign's status as the platform has it now. Sends nothing. */
export async function planPauseFromInsight(slug: string, key: string): Promise<PausePlan> {
  const base = await context(slug, key)
  if (base.error) return { ok: false, error: base.error }
  if (base.insight.platform !== "linkedin") {
    const p = await previewEdit(base.client, base.insight.platform as EditPlatform, base.insight.campaignId!, { kind: "pause" })
    if (!p.ok) return p
    return { ok: true, name: p.name, status: p.before?.status ?? null, live: p.live, reason: p.reason }
  }
  const c = await linkedInContext(slug, key)
  if (c.error) return { ok: false, error: c.error }
  try {
    const r = await readCampaign(c.campaign.accountId, c.insight.campaignId!)
    if (r.status === "PAUSED") return { ok: false, error: "This campaign is already paused in LinkedIn." }
    return { ok: true, name: r.name || c.campaign.name, status: r.status, live: c.reason === null, reason: c.reason }
  } catch (e) {
    return {
      ok: true,
      name: c.campaign.name,
      status: null,
      live: false,
      reason: linkedInNotConnected(e) ? "LinkedIn isn't connected to Lumaux yet (pnpm ads:connect linkedin): this will be a dry run." : `LinkedIn: ${(e as Error).message}`,
    }
  }
}

/** Pauses the campaign. A live pause marks the recommendation done; a dry run leaves it open. */
export async function pauseFromInsight(slug: string, key: string): Promise<PauseResult> {
  const fail = (message: string): PauseResult => ({ ok: false, live: false, message, lines: [] })
  const base = await context(slug, key)
  if (base.error) return fail(base.error)
  const name = PLATFORM_NAME[base.insight.platform as keyof typeof PLATFORM_NAME] ?? "the platform"

  let r: { ok: boolean; live: boolean; lines: string[]; error?: string }
  let reason: string | null = null
  if (base.insight.platform !== "linkedin") {
    r = await applyEdit(base.me, base.client, base.insight.platform as EditPlatform, base.insight.campaignId!, { kind: "pause" })
    if (!r.live) reason = editDryRunReason({ ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }, base.insight.platform as EditPlatform, base.client.slug)
  } else {
    const c = await linkedInContext(slug, key)
    if (c.error) return fail(c.error)
    reason = c.reason
    const live = c.reason === null
    const limited = await rateLimit(c.supabase, "campaign_edit")
    if (limited) return fail(limited)
    let before: Before = null
    try {
      before = beforeOf(await readCampaign(c.campaign.accountId, c.insight.campaignId!))
    } catch (e) {
      if (live) return fail(`Couldn't read the campaign from LinkedIn first, so nothing was sent. ${(e as Error).message}`)
    }
    r = await runEdit(
      { env: c.env, sender: live ? linkedInEditSender() : null, store: editStore(createAdminClient(c.me.id)) },
      { by: c.me.id, client: { id: c.client.id, slug: c.client.slug }, accountId: c.campaign.accountId, campaignId: c.insight.campaignId!, currency: c.client.currency, change: { kind: "pause" }, before, money: (n) => money(n, c.client.currency) },
    )
  }

  if (r.ok && r.live) {
    await base.supabase.from("insight_actions").insert({
      client_id: base.client.id,
      insight_key: key,
      rule: base.insight.rule,
      action: "done",
      items: [],
      note: `Paused in ${name} from Lumaux`,
      snapshot: toJson({ title: base.insight.title, why: base.insight.why, numbers: base.insight.numbers, atStake: base.insight.atStake, campaign: base.insight.campaignName, paused: true }),
    })
    revalidatePath(`/clients/${slug}/insights`)
  }
  const message = !r.ok ? (r.error ?? `${name} didn't take the change.`) : r.live ? `Paused in ${name}.` : `Dry run: logged, nothing was sent. ${reason ?? ""}`.trim()
  return { ok: r.ok, live: r.live, message, lines: r.lines }
}
