"use server"

import { revalidatePath } from "next/cache"
import { getProfile } from "@/lib/auth"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import { runEdit, type Before } from "@/lib/ads-api/edit"
import { beforeOf, editStore, linkedInCampaignOf, linkedInNotConnected } from "@/lib/ads-api/edit-service"
import { adsApiEditsEnabled, adsApiEnv, editDryRunReason } from "@/lib/ads-api/gates"
import { linkedInEditSender } from "@/lib/ads-api/linkedin"
import { readCampaign } from "@/lib/ads-api/linkedin-read"
import { loadFeed } from "@/lib/insights/feed"
import { canOfferPause } from "@/lib/platform-links"
import { money } from "@/lib/format"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"

// Recommendations › "Pause in LinkedIn" (Dean, 2026-10-21): pause the campaign behind a cost per
// result or no-results recommendation. The same edit as the builder's Pause: the status is read from
// LinkedIn first, logged in platform_write_log with the value before, sent only with the edit
// switches on, and only ever to PAUSED. Turning it back on is done in Campaign Manager.

const NOT_ALLOWED = "Only admins and GTM leads on this client can change LinkedIn campaigns for now."

async function context(slug: string, key: string) {
  const me = await getProfile()
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, currency").eq("slug", slug).maybeSingle()
  if (!client) return { error: "This client isn't available to you." } as const
  if (!(await canBuildCampaigns(me, client.id))) return { error: NOT_ALLOWED } as const
  const insight = (await loadFeed(supabase, client.id))?.insights.find((i) => i.key === key)
  if (!insight) return { error: "This recommendation has gone: the numbers changed since the page loaded." } as const
  if (!canOfferPause(insight.rule, insight.platform, insight.campaignId)) return { error: "This recommendation can't pause a campaign." } as const
  const campaign = await linkedInCampaignOf(client.id, insight.campaignId!)
  if (!campaign) return { error: "That isn't one of this client's LinkedIn campaigns." } as const
  const env = { ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }
  return { me, supabase, client, insight, campaign, env, reason: editDryRunReason(env, "linkedin", client.slug), error: null } as const
}

export type PausePlan = { ok: true; name: string; status: string | null; live: boolean; reason: string | null } | { ok: false; error: string }
export type PauseResult = { ok: boolean; live: boolean; message: string; lines: string[] }

/** What the pause would change: the campaign's status as LinkedIn has it now. Sends nothing. */
export async function planPauseFromInsight(slug: string, key: string): Promise<PausePlan> {
  const c = await context(slug, key)
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
  const c = await context(slug, key)
  if (c.error) return fail(c.error)
  const live = c.reason === null
  const limited = await rateLimit(c.supabase, "campaign_edit")
  if (limited) return fail(limited)

  let before: Before = null
  try {
    before = beforeOf(await readCampaign(c.campaign.accountId, c.insight.campaignId!))
  } catch (e) {
    if (live) return fail(`Couldn't read the campaign from LinkedIn first, so nothing was sent. ${(e as Error).message}`)
  }

  const r = await runEdit(
    { env: c.env, sender: live ? linkedInEditSender() : null, store: editStore(createAdminClient(c.me.id)) },
    { by: c.me.id, client: { id: c.client.id, slug: c.client.slug }, accountId: c.campaign.accountId, campaignId: c.insight.campaignId!, currency: c.client.currency, change: { kind: "pause" }, before, money: (n) => money(n, c.client.currency) },
  )
  if (r.ok && r.live) {
    await c.supabase.from("insight_actions").insert({
      client_id: c.client.id,
      insight_key: key,
      rule: c.insight.rule,
      action: "done",
      items: [],
      note: "Paused in LinkedIn from Lumaux",
      snapshot: toJson({ title: c.insight.title, why: c.insight.why, numbers: c.insight.numbers, atStake: c.insight.atStake, campaign: c.insight.campaignName, paused: true }),
    })
    revalidatePath(`/clients/${slug}/insights`)
  }
  const message = !r.ok ? (r.error ?? "LinkedIn didn't take the change.") : r.live ? "Paused in LinkedIn." : `Dry run: logged, nothing was sent. ${c.reason ?? ""}`.trim()
  return { ok: r.ok, live: r.live, message, lines: r.lines }
}
