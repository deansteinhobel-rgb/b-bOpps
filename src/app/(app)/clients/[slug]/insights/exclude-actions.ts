"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import { runEdit } from "@/lib/ads-api/edit"
import { beforeOf, editStore, linkedInCampaignOf, linkedInNotConnected } from "@/lib/ads-api/edit-service"
import { exclusionFor, matchCompany, seniorityUrn, withExclusions, type ExcludeFacet, type Exclusion } from "@/lib/ads-api/exclusions"
import { adsApiEditsEnabled, adsApiEnv, editDryRunReason } from "@/lib/ads-api/gates"
import { linkedInAudienceCount, linkedInEditSender } from "@/lib/ads-api/linkedin"
import { readCampaign, targetingTypeahead } from "@/lib/ads-api/linkedin-read"
import { UNRESOLVED } from "@/lib/campaign-builder/plan-schema"
import { loadFeed } from "@/lib/insights/feed"
import type { FeedInsight } from "@/lib/insights/rules"
import { money } from "@/lib/format"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"

// Recommendations › "Exclude in LinkedIn" (Dean, 2026-10-21): junior seniorities and companies that
// don't fit, added to the campaigns' exclusions through LinkedIn's API. Same people, switches and log
// as the builder's edits (ADS_API_EDITS_ENABLED on top of the build switches): the targeting is read
// from LinkedIn first, only the one exclude facet changes, the audience must stay at 300+ members,
// and the targeting before is kept in platform_write_log.previous to put back by hand if needed.

const NOT_ALLOWED = "Only admins and GTM leads on this client can change LinkedIn campaigns for now."
const MAX_CAMPAIGNS = 12
const MAX_COMPANIES = 25
const MIN_AUDIENCE = 300
const CLOSED = /^(archived|canceled|cancelled|completed|removed)$/i

export type ExclusionValue = { label: string; urn: string | null; candidates: { name: string; urn: string }[] }
export type ExclusionCampaign = { id: string; name: string; items: string[]; lines: string[]; audience: number | null; error?: string }
export type ExclusionPlan =
  | { ok: true; facet: ExcludeFacet; live: boolean; reason: string | null; connected: boolean; values: ExclusionValue[]; campaigns: ExclusionCampaign[] }
  | { ok: false; error: string }
export type ExclusionResult = { ok: boolean; live: boolean; message: string; campaigns: { name: string; ok: boolean; lines: string[]; error?: string }[] }

async function context(slug: string, key: string, items: string[]) {
  const me = await getProfile()
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, currency").eq("slug", slug).maybeSingle()
  if (!client) return { error: "This client isn't available to you." } as const
  if (!(await canBuildCampaigns(me, client.id))) return { error: NOT_ALLOWED } as const
  const insight = (await loadFeed(supabase, client.id))?.insights.find((i) => i.key === key)
  if (!insight) return { error: "This recommendation has gone: the numbers changed since the page loaded." } as const
  const facet = exclusionFor(insight.rule)
  if (!facet || insight.platform !== "linkedin") return { error: "This recommendation can't be actioned in LinkedIn." } as const
  const wanted = new Set(items)
  const chosen = insight.items.filter((x) => wanted.has(x.id))
  if (!chosen.length) return { error: "Tick at least one." } as const
  if (facet === "employers" && chosen.length > MAX_COMPANIES) return { error: `At most ${MAX_COMPANIES} companies at a time.` } as const
  const env = { ...adsApiEnv(), editsEnabled: adsApiEditsEnabled() }
  return { me, supabase, client, insight, facet, chosen, env, reason: editDryRunReason(env, "linkedin", client.slug), error: null } as const
}

/** Which campaigns get which items: the recommendation's campaign, or each company's campaigns. */
function targets(insight: FeedInsight, facet: ExcludeFacet, chosen: FeedInsight["items"]) {
  const byCampaign = new Map<string, string[]>()
  for (const x of chosen) {
    const ids = facet === "seniorities" ? (insight.campaignId ? [insight.campaignId] : []) : (x.campaignIds ?? [])
    for (const id of ids) byCampaign.set(id, [...(byCampaign.get(id) ?? []), x.id])
  }
  return [...byCampaign]
}

/** Step 1: what would change on each campaign, with company matches to confirm. Sends nothing. */
export async function planLinkedInExclusion(slug: string, key: string, items: string[]): Promise<ExclusionPlan> {
  const c = await context(slug, key, z.array(z.string().max(600)).max(500).parse(items))
  if (c.error) return { ok: false, error: c.error }

  let connected = true
  const values: ExclusionValue[] = []
  if (c.facet === "seniorities") {
    for (const x of c.chosen) values.push({ label: x.label, urn: seniorityUrn(x.label), candidates: [] })
  } else {
    const limited = await rateLimit(c.supabase, "targeting_lookup")
    if (limited) return { ok: false, error: limited }
    for (const x of c.chosen) {
      if (!connected) {
        values.push({ label: x.label, urn: null, candidates: [] })
        continue
      }
      try {
        values.push({ label: x.label, ...matchCompany(x.label, await targetingTypeahead("employers", x.label)) })
      } catch (e) {
        if (linkedInNotConnected(e)) connected = false
        else return { ok: false, error: `LinkedIn: ${(e as Error).message}` }
        values.push({ label: x.label, urn: null, candidates: [] })
      }
    }
  }

  const byLabel = new Map(values.map((v) => [v.label, v]))
  const campaigns: ExclusionCampaign[] = []
  for (const [id, ids] of targets(c.insight, c.facet, c.chosen).slice(0, MAX_CAMPAIGNS)) {
    const campaign = await linkedInCampaignOf(c.client.id, id)
    if (!campaign) continue
    const labels = c.chosen.filter((x) => ids.includes(x.id)).map((x) => x.label)
    const row: ExclusionCampaign = { id, name: campaign.name, items: labels, lines: [], audience: null }
    if (campaign.status && CLOSED.test(campaign.status)) {
      campaigns.push({ ...row, error: `The campaign is ${campaign.status.toLowerCase()}: nothing to change.` })
      continue
    }
    const vals = labels.map((l) => byLabel.get(l)!).filter((v) => v.urn).map((v) => ({ urn: v.urn!, name: v.label }))
    if (!connected) {
      campaigns.push({ ...row, lines: [`Would exclude: ${labels.join(", ")}`] })
      continue
    }
    try {
      const r = await readCampaign(campaign.accountId, id)
      if (!vals.length) {
        campaigns.push({ ...row, error: "Pick the LinkedIn company for each name first." })
        continue
      }
      const { targeting, added, already } = withExclusions(r.targetingCriteria, c.facet, vals)
      row.lines = [`Exclude: + ${added.map((v) => v.name).join(", ")}`, ...(already.length ? [`Already excluded: ${already.map((v) => v.name).join(", ")}`] : [])]
      row.audience = await linkedInAudienceCount(targeting).catch(() => null)
      campaigns.push(row)
    } catch (e) {
      if (linkedInNotConnected(e)) connected = false
      campaigns.push({ ...row, lines: [`Would exclude: ${labels.join(", ")}`], error: linkedInNotConnected(e) ? undefined : (e as Error).message })
    }
  }
  if (!campaigns.length) return { ok: false, error: "None of the campaigns behind this are this client's LinkedIn campaigns." }
  return { ok: true, facet: c.facet, live: c.reason === null && connected, reason: connected ? c.reason : "LinkedIn isn't connected to Lumaux yet (pnpm ads:connect linkedin): this will be a dry run.", connected, values, campaigns }
}

const Send = z.object({
  items: z.array(z.string().max(600)).min(1).max(500),
  /** Companies: the LinkedIn company the person confirmed for each name. */
  urns: z.record(z.string().max(600), z.string().regex(/^urn:li:organization:\d+$/)).default({}),
})

/** Step 2: one edit per campaign. Marks the items done when every campaign they were on changed. */
export async function sendLinkedInExclusion(slug: string, key: string, raw: z.input<typeof Send>): Promise<ExclusionResult> {
  const fail = (message: string): ExclusionResult => ({ ok: false, live: false, message, campaigns: [] })
  const p = Send.safeParse(raw)
  if (!p.success) return fail("Check the selection.")
  const c = await context(slug, key, p.data.items)
  if (c.error) return fail(c.error)
  const live = c.reason === null

  // Seniorities come from LinkedIn's fixed ids, never from the browser; companies are the ones confirmed.
  const valueOf = (label: string): Exclusion | null => {
    const urn = c.facet === "seniorities" ? seniorityUrn(label) : (p.data.urns[label] ?? null)
    return urn ? { urn, name: label } : live ? null : { urn: `${UNRESOLVED}${label.replace(/\s+/g, "_").slice(0, 120)}`, name: label }
  }

  const db = createAdminClient(c.me.id)
  const results: ExclusionResult["campaigns"] = []
  const failedItems = new Set<string>()
  for (const [id, ids] of targets(c.insight, c.facet, c.chosen).slice(0, MAX_CAMPAIGNS)) {
    const chosenHere = c.chosen.filter((x) => ids.includes(x.id))
    const failHere = (name: string, error: string) => {
      chosenHere.forEach((x) => failedItems.add(x.id))
      results.push({ name, ok: false, lines: [], error })
    }
    const campaign = await linkedInCampaignOf(c.client.id, id)
    if (!campaign) {
      failHere(id, "Not one of this client's LinkedIn campaigns.")
      continue
    }
    if (campaign.status && CLOSED.test(campaign.status)) continue
    const values = chosenHere.map((x) => valueOf(x.label)).filter((v): v is Exclusion => v !== null)
    if (!values.length) {
      failHere(campaign.name, "No LinkedIn company picked, so nothing was sent.")
      continue
    }
    const limited = await rateLimit(c.supabase, "campaign_edit")
    if (limited) {
      failHere(campaign.name, limited)
      break
    }

    let before = null
    try {
      before = beforeOf(await readCampaign(campaign.accountId, id), true)
    } catch (e) {
      if (live) {
        failHere(campaign.name, `Couldn't read the campaign from LinkedIn first, so nothing was sent. ${(e as Error).message}`)
        continue
      }
    }
    if (live && before) {
      // The audience after the change must still be big enough to deliver.
      try {
        const { targeting } = withExclusions(before.targetingCriteria, c.facet, values)
        const count = await linkedInAudienceCount(targeting)
        if (count < MIN_AUDIENCE) {
          failHere(campaign.name, `The audience would drop under LinkedIn's ${MIN_AUDIENCE} members, so nothing was sent.`)
          continue
        }
      } catch (e) {
        failHere(campaign.name, (e as Error).message)
        continue
      }
    }

    const r = await runEdit(
      { env: c.env, sender: live ? linkedInEditSender() : null, store: editStore(db) },
      { by: c.me.id, client: { id: c.client.id, slug: c.client.slug }, accountId: campaign.accountId, campaignId: id, currency: c.client.currency, change: { kind: "exclude", facet: c.facet, values }, before, money: (n) => money(n, c.client.currency) },
    )
    if (!r.ok || !r.live) chosenHere.forEach((x) => failedItems.add(x.id))
    results.push({ name: campaign.name, ok: r.ok, lines: r.lines, error: r.error })
  }

  // Only real changes close the items; a dry run leaves the recommendation open.
  const done = live ? c.chosen.filter((x) => !failedItems.has(x.id)).map((x) => x.id) : []
  if (done.length) {
    await c.supabase.from("insight_actions").insert({
      client_id: c.client.id,
      insight_key: key,
      rule: c.insight.rule,
      action: "done",
      items: done,
      note: "Excluded in LinkedIn from Lumaux",
      snapshot: toJson({ title: c.insight.title, why: c.insight.why, numbers: c.insight.numbers, atStake: c.insight.atStake, campaign: c.insight.campaignName, items: c.insight.items.filter((x) => done.includes(x.id)).map((x) => ({ id: x.id, note: x.note ?? null })), campaigns: results }),
    })
    revalidatePath(`/clients/${slug}/insights`)
  }
  const okCount = results.filter((r) => r.ok).length
  const message = !results.length
    ? "Nothing to change."
    : live
      ? `${okCount} of ${results.length} campaign${results.length === 1 ? "" : "s"} changed in LinkedIn.`
      : `Dry run: logged ${okCount} change${okCount === 1 ? "" : "s"}, nothing was sent. ${c.reason ?? ""}`.trim()
  return { ok: okCount > 0 && okCount === results.length, live, message, campaigns: results }
}
