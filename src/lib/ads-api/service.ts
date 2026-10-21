import "server-only"
import type { Profile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"
import { canBuildCampaigns } from "./access"
import { runBuild, type BuildStep, type RunResult, type Sender } from "./build"
import { adsApiEnv, dryRunReason, type AdsApiPlatform } from "./gates"
import { linkedInAudienceCount, linkedInSender } from "./linkedin"
import { linkedInSteps, linkedInTargeting, redditSteps } from "./plan"
import { redditSender } from "./reddit"
import { checkLinkedIn, checkReddit, type BuildContext, type Check } from "./spec"
import { buildStore } from "./store"

/**
 * Saving and sending campaign builds (Dean, 2026-10-21). Every check runs on the server, every
 * time: who you are, that the account is one of the client's own, the plan itself, the budget guard
 * and (live, LinkedIn) the 300-member audience minimum. Then runBuild logs and sends each step.
 */

type Client = { id: string; slug: string; website: string | null; currency: string }

async function loadContext(clientId: string, platform: AdsApiPlatform, accountId: string): Promise<{ client: Client; ctx: BuildContext } | { error: string }> {
  const db = createAdminClient()
  const { data: client } = await db.from("clients").select("id, slug, website, currency").eq("id", clientId).single()
  if (!client) return { error: "Client not found." }
  const { data: account } = await db.from("client_platform_accounts").select("monthly_budget").eq("client_id", clientId).eq("platform", platform).eq("external_account_id", accountId).eq("active", true).maybeSingle()
  if (!account) return { error: "That ad account isn't one of this client's active accounts." }

  const today = londonToday()
  const month = `${today.slice(0, 7)}-01`
  const { data: budgets } = await db.from("client_budgets").select("amount").eq("client_id", clientId).eq("platform", platform).eq("month", month).eq("campaign_id", "")
  const { data: daily } = await db.rpc("platform_daily", { p_client: clientId, p_from: month, p_to: today })
  const spent = (daily ?? []).filter((d) => d.platform === platform).reduce((sum, d) => sum + Number(d.spend), 0)
  const monthBudget = budgets?.length ? Number(budgets[0].amount) : account.monthly_budget
  return { client, ctx: { website: client.website, monthBudget, spentThisMonth: spent, today } }
}

function check(platform: AdsApiPlatform, spec: unknown, ctx: BuildContext, accountId: string, currency: string): Check & { steps?: BuildStep[] } {
  if (platform === "linkedin") {
    const r = checkLinkedIn(spec, ctx)
    return r.spec && r.ok ? { ...r, steps: linkedInSteps(r.spec, accountId, currency) } : r
  }
  const r = checkReddit(spec, ctx)
  return r.spec && r.ok ? { ...r, steps: redditSteps(r.spec) } : r
}

export type SaveInput = { clientId: string; platform: AdsApiPlatform; accountId: string; name: string; spec: unknown; sprintTestId?: string | null }

/** Saves a draft build after checking it. Nothing is sent. */
export async function saveCampaignBuild(me: Profile, input: SaveInput): Promise<{ id?: string; check: Check }> {
  const refuse = (error: string) => ({ check: { ok: false, errors: [error], warnings: [] } })
  if (!(await canBuildCampaigns(me, input.clientId))) return refuse("Only admins and GTM leads on this client can build campaigns for now.")
  const limited = await rateLimit(await createClient(), "campaign_build")
  if (limited) return refuse(limited)
  const loaded = await loadContext(input.clientId, input.platform, input.accountId)
  if ("error" in loaded) return refuse(loaded.error)
  const c = check(input.platform, input.spec, loaded.ctx, input.accountId, loaded.client.currency)
  if (!c.ok) return { check: c }

  const { data, error } = await createAdminClient()
    .from("campaign_builds")
    .insert({
      client_id: input.clientId,
      platform: input.platform,
      external_account_id: input.accountId,
      sprint_test_id: input.sprintTestId ?? null,
      name: input.name.slice(0, 255),
      spec: toJson(input.spec),
      created_by: me.id,
    })
    .select("id")
    .single()
  if (error || !data) return refuse("Couldn't save the build.")
  return { id: data.id, check: c }
}

/** Sends a saved build: a dry run unless every switch is on (gates.ts). */
export async function sendCampaignBuild(me: Profile, buildId: string): Promise<RunResult & { check?: Check }> {
  const refuse = (error: string): RunResult => ({ ok: false, live: false, status: "failed", steps: [], ids: {}, error })
  const db = createAdminClient()
  const { data: build } = await db.from("campaign_builds").select("id, client_id, platform, external_account_id, spec, created_ids, status").eq("id", buildId).single()
  if (!build) return refuse("Build not found.")
  if (!(await canBuildCampaigns(me, build.client_id))) return refuse("Only admins and GTM leads on this client can build campaigns for now.")
  if (build.status === "created" || build.status === "sending") return refuse(build.status === "created" ? "This build was already created." : "This build is being sent.")
  const limited = await rateLimit(await createClient(), "campaign_build")
  if (limited) return refuse(limited)

  const platform = build.platform as AdsApiPlatform
  const loaded = await loadContext(build.client_id, platform, build.external_account_id)
  if ("error" in loaded) return refuse(loaded.error)
  const c = check(platform, build.spec, loaded.ctx, build.external_account_id, loaded.client.currency)
  if (!c.ok || !c.steps) return { ...refuse(c.errors.join(" ")), check: c }

  const env = adsApiEnv()
  const live = dryRunReason(env, platform, loaded.client.slug) === null
  let sender: Sender | null = null
  if (live) {
    if (platform === "linkedin") {
      const spec = checkLinkedIn(build.spec, loaded.ctx).spec!
      const members = await linkedInAudienceCount(linkedInTargeting(spec.campaign.targeting)).catch(() => null)
      if (members === null) return { ...refuse("Couldn't check the audience size with LinkedIn. Nothing was sent."), check: c }
      if (members < 300) return { ...refuse("LinkedIn says this audience is under 300 members, its minimum. Nothing was sent."), check: c }
      sender = linkedInSender()
    } else {
      sender = redditSender()
    }
  }

  const ids = (build.created_ids ?? {}) as Record<string, string>
  const result = await runBuild(
    { store: buildStore(), sender, env },
    { id: build.id, platform, external_account_id: build.external_account_id, created_ids: ids, client: { id: loaded.client.id, slug: loaded.client.slug } },
    c.steps,
    me,
  )
  return { ...result, check: c }
}
