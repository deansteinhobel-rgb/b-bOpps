import "server-only"
import type { Profile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { checkFacts, linkedInFacts, rulesFor, type GuardFacts, type PlaybookRule } from "@/lib/campaign-builder/guardrails"
import type { BuilderMode } from "@/lib/campaign-builder/presets"
import type { Platform } from "@/lib/metrics/types"
import { fromJson, toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"
import { runAction } from "@/lib/windsor/mcp"
import { canBuildCampaigns } from "./access"
import { runBuild, type BuildStep, type RunResult, type Sender } from "./build"
import { adsApiEnv, dryRunReason, type AdsApiPlatform } from "./gates"
import { linkedInAudienceCount, linkedInSender } from "./linkedin"
import { microsoftSender } from "./microsoft"
import { linkedInSteps, linkedInTargeting, redditSteps } from "./plan"
import { googleSteps, metaSteps, microsoftSteps } from "./plan-platforms"
import { metaAdSetTargeting } from "./platform-edit-service"
import { redditSender } from "./reddit"
import { checkLinkedIn, checkReddit, type BuildContext, type Check, type RedditSpec } from "./spec"
import { checkGoogle, checkMeta, checkMicrosoft, metaFacts, searchFacts } from "./spec-platforms"
import { buildStore } from "./store"
import { accessToken } from "./tokens"
import { windsorSender } from "./windsor-sender"

/**
 * Saving and sending campaign builds (Dean, 2026-10-21). Every check runs on the server, every
 * time: who you are, that the account is one of the client's own, the plan itself, the budget guard
 * and (live, LinkedIn) the 300-member audience minimum. Then runBuild logs and sends each step.
 */

type Client = { id: string; slug: string; website: string | null; currency: string }

/** The platforms in our metrics (client_platform_accounts, client_budgets). Microsoft Ads isn't one yet: reporting comes first. */
export const reportedPlatform = (p: AdsApiPlatform): Platform | null => (p === "microsoft_ads" ? null : p)

async function loadContext(clientId: string, platform: AdsApiPlatform, accountId: string): Promise<{ client: Client; ctx: BuildContext } | { error: string }> {
  const db = createAdminClient()
  const { data: client } = await db.from("clients").select("id, slug, website, currency").eq("id", clientId).single()
  if (!client) return { error: "Client not found." }
  const reported = reportedPlatform(platform)
  if (!reported) return { error: "No Microsoft Ads account is mapped for this client yet." }
  const { data: account } = await db.from("client_platform_accounts").select("monthly_budget").eq("client_id", clientId).eq("platform", reported).eq("external_account_id", accountId).eq("active", true).maybeSingle()
  if (!account) return { error: "That ad account isn't one of this client's active accounts." }

  const today = londonToday()
  const month = `${today.slice(0, 7)}-01`
  const { data: budgets } = await db.from("client_budgets").select("amount").eq("client_id", clientId).eq("platform", reported).eq("month", month).eq("campaign_id", "")
  const { data: daily } = await db.rpc("platform_daily", { p_client: clientId, p_from: month, p_to: today })
  const spent = (daily ?? []).filter((d) => d.platform === platform).reduce((sum, d) => sum + Number(d.spend), 0)
  const monthBudget = budgets?.length ? Number(budgets[0].amount) : account.monthly_budget
  return { client, ctx: { website: client.website, monthBudget, spentThisMonth: spent, today, clientId } }
}

/**
 * The platform's checks, then the team's guardrails (ad_playbook_rules, on every save, dry run and
 * send), then the steps a send would run.
 */
function check(platform: AdsApiPlatform, spec: unknown, ctx: BuildContext, accountId: string, currency: string, rules: PlaybookRule[] = []): Check & { steps?: BuildStep[] } {
  const finish = <S,>(r: Check & { spec?: S }, facts: (s: S) => GuardFacts, steps: (s: S) => BuildStep[]): Check & { steps?: BuildStep[] } => {
    if (r.spec) r.errors.push(...checkFacts(facts(r.spec), rules))
    const ok = r.errors.length === 0
    return r.spec && ok ? { ok, errors: r.errors, warnings: r.warnings, steps: steps(r.spec) } : { ok, errors: r.errors, warnings: r.warnings }
  }
  switch (platform) {
    case "linkedin":
      return finish(checkLinkedIn(spec, ctx), linkedInFacts, (s) => linkedInSteps(s, accountId, currency))
    case "google_ads":
      return finish(checkGoogle(spec, ctx), searchFacts, googleSteps)
    case "meta":
      return finish(checkMeta(spec, ctx), metaFacts, metaSteps)
    case "microsoft_ads":
      return finish(checkMicrosoft(spec, ctx), searchFacts, (s) => microsoftSteps(s, currency))
    case "reddit":
      return finish(checkReddit(spec, ctx), redditFacts, redditSteps)
  }
}

const redditFacts = (s: RedditSpec): GuardFacts => ({ dailyBudget: s.adGroup.dailyBudget, bid: s.adGroup.bid ?? null, ads: s.ads.length, objective: s.campaign.objective, headlines: [], intros: [], facets: Object.keys(s.adGroup.targeting) })

/**
 * Meta builds whose audience starts from one of the account's ad sets: that ad set's whole targeting,
 * read from Windsor when the build is saved, goes into the spec, so the dry run logs exactly what a
 * live run sends. Other platforms' specs pass through.
 */
async function withMetaBase(platform: AdsApiPlatform, clientId: string, accountId: string, spec: unknown): Promise<{ spec: unknown } | { error: string }> {
  if (platform !== "meta") return { spec }
  const s = spec as { adSet?: { targeting?: { baseAdSetId?: string; base?: unknown } } }
  const t = s?.adSet?.targeting
  if (!t?.baseAdSetId || t.base) return { spec }
  const base = await metaAdSetTargeting(clientId, accountId, t.baseAdSetId).catch(() => null)
  if (!base) return { error: "Couldn't read the audience of the ad set to copy from Windsor. Pick another, or clear it." }
  return { spec: { ...s, adSet: { ...s.adSet, targeting: { ...t, base } } } }
}

/** A one-hour link to a build image, for Meta to fetch it (the spec checked it's the client's). */
async function campaignImageLink(path: string) {
  const { data, error } = await createAdminClient().storage.from("campaign-assets").createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw new Error("Couldn't make a link to the image.")
  return data.signedUrl
}

/** The guardrails for a build: every-client rules and the client's own, for its view. */
async function guardrails(clientId: string, platform: AdsApiPlatform, mode: BuilderMode) {
  const { data } = await createAdminClient().from("ad_playbook_rules").select("id, platform, client_id, kind, modes, title, body, check_rule").eq("platform", platform).eq("kind", "guardrail").is("removed_at", null).or(`client_id.is.null,client_id.eq.${clientId}`)
  return rulesFor((data ?? []).map((r) => ({ ...r, kind: r.kind as PlaybookRule["kind"], check_rule: fromJson<PlaybookRule["check_rule"]>(r.check_rule, null) })), { platform, clientId, mode })
}

export type SaveInput = { clientId: string; platform: AdsApiPlatform; accountId: string; name: string; spec: unknown; sprintTestId?: string | null; planId?: string | null; mode?: BuilderMode }

/** Saves a draft build after checking it. Nothing is sent. */
export async function saveCampaignBuild(me: Profile, input: SaveInput): Promise<{ id?: string; check: Check }> {
  const refuse = (error: string) => ({ check: { ok: false, errors: [error], warnings: [] } })
  if (!(await canBuildCampaigns(me, input.clientId))) return refuse("Only admins and GTM leads on this client can build campaigns for now.")
  const limited = await rateLimit(await createClient(), "campaign_build")
  if (limited) return refuse(limited)
  const loaded = await loadContext(input.clientId, input.platform, input.accountId)
  if ("error" in loaded) return refuse(loaded.error)
  const based = await withMetaBase(input.platform, input.clientId, input.accountId, input.spec)
  if ("error" in based) return refuse(based.error)
  input = { ...input, spec: based.spec }
  const c = check(input.platform, input.spec, loaded.ctx, input.accountId, loaded.client.currency, await guardrails(input.clientId, input.platform, input.mode ?? "general"))
  if (!c.ok) return { check: c }

  const { data, error } = await createAdminClient(me.id)
    .from("campaign_builds")
    .insert({
      client_id: input.clientId,
      platform: input.platform,
      external_account_id: input.accountId,
      sprint_test_id: input.sprintTestId ?? null,
      plan_id: input.planId ?? null,
      mode: input.mode ?? "general",
      name: input.name.slice(0, 255),
      spec: toJson(input.spec),
      created_by: me.id,
    })
    .select("id")
    .single()
  if (error || !data) return refuse("Couldn't save the build.")
  return { id: data.id, check: c }
}

/** Sends a saved build: a dry run unless every switch is on (gates.ts), or when the person asked for a dry run. */
export async function sendCampaignBuild(me: Profile, buildId: string, opts: { dryRun?: boolean } = {}): Promise<RunResult & { check?: Check }> {
  const refuse = (error: string): RunResult => ({ ok: false, live: false, status: "failed", steps: [], ids: {}, error })
  const db = createAdminClient()
  const { data: build } = await db.from("campaign_builds").select("id, client_id, platform, external_account_id, spec, created_ids, status, mode").eq("id", buildId).single()
  if (!build) return refuse("Build not found.")
  if (!(await canBuildCampaigns(me, build.client_id))) return refuse("Only admins and GTM leads on this client can build campaigns for now.")
  if (build.status === "created" || build.status === "sending") return refuse(build.status === "created" ? "This build was already created." : "This build is being sent.")
  const limited = await rateLimit(await createClient(), "campaign_build")
  if (limited) return refuse(limited)

  const platform = build.platform as AdsApiPlatform
  const loaded = await loadContext(build.client_id, platform, build.external_account_id)
  if ("error" in loaded) return refuse(loaded.error)
  const c = check(platform, build.spec, loaded.ctx, build.external_account_id, loaded.client.currency, await guardrails(build.client_id, platform, build.mode as BuilderMode))
  if (!c.ok || !c.steps) return { ...refuse(c.errors.join(" ")), check: c }

  const env = { ...adsApiEnv(), forced: Boolean(opts.dryRun) }
  const live = dryRunReason(env, platform, loaded.client.slug) === null
  let sender: Sender | null = null
  if (live) {
    if (platform === "linkedin") {
      const spec = checkLinkedIn(build.spec, loaded.ctx).spec!
      const targeting = Object.values({ ...spec.campaign.targeting.include, ...(spec.campaign.targeting.exclude ?? {}) }).flat()
      if (targeting.some((u) => u.startsWith("urn:li:unresolved:"))) return { ...refuse("Some audience values have no LinkedIn id yet. Look them up on the plan first. Nothing was sent."), check: c }
      const members = await linkedInAudienceCount(linkedInTargeting(spec.campaign.targeting)).catch(() => null)
      if (members === null) return { ...refuse("Couldn't check the audience size with LinkedIn. Nothing was sent."), check: c }
      if (members < 300) return { ...refuse("LinkedIn says this audience is under 300 members, its minimum. Nothing was sent."), check: c }
      sender = linkedInSender()
    } else if (platform === "google_ads" || platform === "meta") {
      const key = process.env.WINDSOR_API_KEY
      if (!key) return { ...refuse("WINDSOR_API_KEY isn't set, so nothing can be sent to Windsor. Nothing was sent."), check: c }
      sender = windsorSender(platform, { run: (connector, action, account, params) => runAction(key, connector, action, account, params), signedUrl: campaignImageLink })
    } else if (platform === "microsoft_ads") {
      sender = microsoftSender({ token: () => accessToken("microsoft_ads"), developerToken: process.env.MICROSOFT_ADS_DEVELOPER_TOKEN ?? "", customerId: process.env.MICROSOFT_ADS_CUSTOMER_ID ?? "" })
    } else {
      sender = redditSender()
    }
  }

  const ids = (build.created_ids ?? {}) as Record<string, string>
  const result = await runBuild(
    { store: buildStore(me.id), sender, env },
    { id: build.id, platform, external_account_id: build.external_account_id, created_ids: ids, client: { id: loaded.client.id, slug: loaded.client.slug } },
    c.steps,
    me,
  )
  return { ...result, check: c }
}
