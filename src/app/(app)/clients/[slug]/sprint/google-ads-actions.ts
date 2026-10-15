"use server"

import { createHash } from "node:crypto"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"
import { canWriteGoogleAds } from "@/lib/windsor/access"
import { createParams, createSearchAd, DESCRIPTIONS, HEADLINES, MAX_PAUSE, pauseAds, type AdWriteResult } from "@/lib/windsor/google-ads"
import { campaignAccount, liveCampaign, type LiveCampaign } from "@/lib/windsor/google-ads-live"
import { adWriteDeps, windsorAdWritesLive } from "@/lib/windsor/mcp"

// "Build in Google Ads" on a sprint test (Dean, 2026-10-15): create a paused responsive search ad,
// and pause the ads it replaces. Everything Google-side (account, ad groups, ads) is read again here
// from our data and Windsor, never taken from the browser.

/** Test statuses the card shows "Build in Google Ads" for: briefed (in production or ready from Notion), ready, live. */
const BUILDABLE = ["briefed", "ready", "live"]

const fail = (error: string): AdWriteResult => ({ ok: false, live: false, writes: [], error })

async function context(testId: string, campaignId: string) {
  if (!/^\d{1,20}$/.test(campaignId)) return { error: "Pick a Google Ads campaign." } as const
  const me = await getProfile()
  const supabase = await createClient()
  const { data: test } = await supabase.from("sprint_tests").select("id, platform, status, outcome, client_id, sprints(closed_at), clients(id, slug)").eq("id", testId).maybeSingle()
  if (!test) return { error: "This test isn't available to you." } as const
  const sprint = test.sprints as unknown as { closed_at: string | null } | null
  const client = test.clients as unknown as { id: string; slug: string }
  if (sprint?.closed_at) return { error: "This sprint is closed." } as const
  if (test.platform !== "google_ads") return { error: "This isn't a Google Ads test." } as const
  // The same stages the card offers it in (in production, ready, live), checked here too (Aikido).
  if (test.outcome || !BUILDABLE.includes(test.status)) return { error: "Ads can only be built for a test that's in production, ready or live." } as const
  if (!(await canWriteGoogleAds(me, client.id))) return { error: "Only admins, GTM leads and the client's paid media specialist can change ads in Google Ads." } as const
  const accountId = await campaignAccount(supabase, client.id, campaignId)
  if (!accountId) return { error: "Couldn't tell which of this client's Google Ads accounts that campaign is in." } as const
  return { me, supabase, test, client, accountId, error: null } as const
}

/** The campaign's ad groups and ads as Google has them now (last 14 days), for the build dialog. */
export async function googleCampaignAds(testId: string, campaignId: string): Promise<{ ok: true; campaign: LiveCampaign; live: boolean } | { ok: false; message: string }> {
  const c = await context(testId, campaignId)
  if (c.error) return { ok: false, message: c.error }
  try {
    return { ok: true, campaign: await liveCampaign(c.accountId, campaignId, londonToday()), live: windsorAdWritesLive(c.client.slug) }
  } catch (e) {
    return { ok: false, message: `Couldn't read the campaign from Windsor: ${(e as Error).message}` }
  }
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return ""
  }
}

const Create = z.object({
  campaignId: z.string(),
  adGroupId: z.string().regex(/^\d{1,20}$/),
  headlines: z.array(z.string().max(200)).max(HEADLINES.max),
  descriptions: z.array(z.string().max(400)).max(DESCRIPTIONS.max),
  finalUrl: z.string().max(2000),
  path1: z.string().max(100),
  path2: z.string().max(100),
  proofread: z.literal(true),
})

/** Create one responsive search ad, paused. Dry run until Dean switches ad writes on. */
export async function createGoogleSearchAd(testId: string, raw: z.input<typeof Create>): Promise<AdWriteResult> {
  const parsed = Create.safeParse(raw)
  if (!parsed.success) return fail(raw?.proofread !== true ? "Tick that you've proofread every line." : "Check the ad: something is missing or too long.")
  const input = parsed.data
  const c = await context(testId, input.campaignId)
  if (c.error) return fail(c.error)

  let live: LiveCampaign
  try {
    live = await liveCampaign(c.accountId, input.campaignId, londonToday())
  } catch (e) {
    return fail(`Couldn't read the campaign from Windsor, so nothing was sent: ${(e as Error).message}`)
  }
  const group = live.adGroups.find((g) => g.id === input.adGroupId)
  if (!group) return fail("That ad group isn't in this campaign (or had no impressions in 14 days). Reload and pick again.")
  // A typo in the domain sends paid clicks nowhere: the link must be on a domain this campaign's ads already use.
  const domains = new Set(live.adGroups.flatMap((g) => g.ads.map((a) => host(a.textAd?.finalUrl ?? ""))).filter(Boolean))
  // No known domain means nothing to check against, so nothing is created (Aikido).
  if (!domains.size) return fail("Couldn't find the domain this campaign's ads use, so the final URL can't be checked. Nothing was created.")
  if (!domains.has(host(input.finalUrl))) return fail(`The final URL isn't on ${[...domains].join(" or ")}, the domain this campaign's ads use.`)

  // The same ad for the same test, already logged in the last day (a double click): don't create it twice.
  // The quick check below gives a clear message; the unique key on the log makes it atomic (Aikido).
  const params = createParams(input.adGroupId, input)
  const idempotencyKey = createHash("sha256").update(JSON.stringify([testId, londonToday(), c.accountId, params])).digest("hex")
  const since = new Date(Date.now() - 86400_000).toISOString()
  const { data: earlier } = await c.supabase.from("platform_write_log").select("payload, success").eq("sprint_test_id", testId).eq("operation", "create_responsive_search_ad").gte("created_at", since).limit(50)
  if ((earlier ?? []).some((r) => r.success !== false && JSON.stringify((r.payload as { params?: unknown })?.params) === JSON.stringify(params)))
    return fail("This exact ad was already created for this test today.")

  const limited = await rateLimit(c.supabase, "google_ad_write")
  if (limited) return fail(limited)
  return createSearchAd(adWriteDeps(), { client: c.client, accountId: c.accountId, campaignId: input.campaignId, testId, by: { id: c.me.id }, idempotencyKey, adGroupId: input.adGroupId, copy: input })
}

const Pause = z.object({
  campaignId: z.string(),
  ads: z.array(z.object({ adGroupId: z.string().regex(/^\d{1,20}$/), adId: z.string().regex(/^\d{1,20}$/) })).min(1).max(MAX_PAUSE),
})

/** Pause ads the test replaces. Only ads that are enabled in this campaign now. Dry run until Dean switches ad writes on. */
export async function pauseGoogleAds(testId: string, raw: z.input<typeof Pause>): Promise<AdWriteResult> {
  const parsed = Pause.safeParse(raw)
  if (!parsed.success) return fail("Pick the ads to pause.")
  const input = parsed.data
  const c = await context(testId, input.campaignId)
  if (c.error) return fail(c.error)
  let live: LiveCampaign
  try {
    live = await liveCampaign(c.accountId, input.campaignId, londonToday())
  } catch (e) {
    return fail(`Couldn't read the campaign from Windsor, so nothing was paused: ${(e as Error).message}`)
  }
  for (const a of input.ads) {
    const ad = live.adGroups.find((g) => g.id === a.adGroupId)?.ads.find((x) => x.adId === a.adId)
    if (!ad) return fail("One of the ads isn't in this campaign any more. Reload and pick again.")
    if (ad.status !== "ENABLED") return fail("One of the ads isn't running, so there's nothing to pause.")
  }
  const limited = await rateLimit(c.supabase, "google_ad_write")
  if (limited) return fail(limited)
  return pauseAds(adWriteDeps(), { client: c.client, accountId: c.accountId, campaignId: input.campaignId, testId, by: { id: c.me.id }, ads: input.ads })
}
