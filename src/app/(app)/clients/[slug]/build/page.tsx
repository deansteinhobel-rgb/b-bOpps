import { notFound } from "next/navigation"
import { getProfile, isAdmin } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import { adsApiEditsEnabled, adsApiEnv, dryRunReason, editDryRunReason } from "@/lib/ads-api/gates"
import { rulesFor, type PlaybookRule } from "@/lib/campaign-builder/guardrails"
import { linkedInHistory } from "@/lib/campaign-builder/history"
import { latestNaming } from "@/lib/campaign-builder/naming"
import { plan as planSchema, question, type Question } from "@/lib/campaign-builder/plan-schema"
import { isAbxCampaign } from "@/lib/campaign-builder/presets"
import { latestPlaybook } from "@/lib/campaign-builder/research"
import { segmentOf, segmentsFor } from "@/lib/metrics/segments"
import { fromJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"
import { loadTargets, targetFor } from "@/lib/targets"
import { BuilderView, type BuildRow, type PlanRow } from "./builder-view"

export const metadata = { title: "Campaign builder" }
// Research by hand runs in the background (after()).
export const maxDuration = 300

/**
 * Planning › Campaign builder (Dean, 2026-10-21; LinkedIn first). Two views: General and ABX
 * (account-based). Pick a preset, say what you want (or paste the proposal), and Claude plans the
 * campaign from everything Lumaux knows about the client, asking only what's missing. The team
 * reviews it and builds it, paused, through LinkedIn's API (a dry run until the switches are on).
 * The view's live campaigns can be paused or edited from here, and the playbook (research and the
 * team's rules) sits underneath.
 */
export default async function BuildPage({ params, searchParams }: PageProps<"/clients/[slug]/build">) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, name, slug, currency, website, monthly_kpi_target").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const mode = sp.view === "abx" ? "abx" : "general"

  // Clients with segment rules (Camber's SMB / ABX) use them; everyone else goes by the campaign name.
  const segments = segmentsFor(slug)
  const abxOf = segments.some((s) => s.key === "abx") ? (name: string) => segmentOf(segments, name) === "abx" : isAbxCampaign

  const [canBuild, history, accounts, plans, builds, rules, playbook, naming, targets, tests] = await Promise.all([
    canBuildCampaigns(me, client.id),
    linkedInHistory(supabase, client.id, abxOf),
    supabase.from("client_platform_accounts").select("external_account_id, account_name").eq("client_id", client.id).eq("platform", "linkedin").eq("active", true),
    supabase.from("campaign_build_plans").select("id, mode, preset, request, status, questions, answers, plan, error, campaign_build_id, created_at, profiles:created_by(full_name)").eq("client_id", client.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("campaign_builds").select("id, name, status, mode, error, dry_run_at, created_ids, created_at, plan_id").eq("client_id", client.id).eq("platform", "linkedin").order("created_at", { ascending: false }).limit(20),
    supabase.from("ad_playbook_rules").select("id, platform, client_id, kind, modes, title, body, check_rule").eq("platform", "linkedin").is("removed_at", null).or(`client_id.is.null,client_id.eq.${client.id}`),
    latestPlaybook(supabase, "linkedin"),
    latestNaming(supabase, client.id, "linkedin"),
    loadTargets(supabase, client.id, client.monthly_kpi_target),
    supabase.from("sprint_tests").select("id, title, status").eq("client_id", client.id).eq("platform", "linkedin").is("outcome", null).is("archived_at", null).order("created_at", { ascending: false }).limit(20),
  ])

  const env = adsApiEnv()
  const buildReason = dryRunReason(env, "linkedin", slug)
  const editReason = editDryRunReason({ ...env, editsEnabled: adsApiEditsEnabled() }, "linkedin", slug)
  const allRules: PlaybookRule[] = (rules.data ?? []).map((r) => ({ ...r, kind: r.kind as PlaybookRule["kind"], check_rule: fromJson<PlaybookRule["check_rule"]>(r.check_rule, null) }))

  const planRows: PlanRow[] = (plans.data ?? []).map((p) => {
    const parsed = planSchema.safeParse(p.plan)
    return {
      id: p.id,
      mode: p.mode as "general" | "abx",
      preset: p.preset,
      request: p.request,
      status: p.status as PlanRow["status"],
      questions: fromJson<Question[]>(p.questions, []).filter((q) => question.safeParse(q).success),
      answers: fromJson<Record<string, string>>(p.answers, {}),
      plan: parsed.success ? parsed.data : null,
      error: p.error,
      buildId: p.campaign_build_id,
      createdAt: p.created_at,
      by: (p.profiles as { full_name: string | null } | null)?.full_name ?? null,
    }
  })
  const buildRows: BuildRow[] = (builds.data ?? []).map((b) => ({ id: b.id, name: b.name, status: b.status, mode: b.mode as "general" | "abx", error: b.error, dryRunAt: b.dry_run_at, createdIds: fromJson<Record<string, string>>(b.created_ids, {}), createdAt: b.created_at, planId: b.plan_id }))

  return (
    <BuilderView
      slug={slug}
      clientName={client.name}
      currency={client.currency}
      website={client.website}
      mode={mode}
      openPlanId={typeof sp.plan === "string" ? sp.plan : null}
      canBuild={canBuild}
      isAdmin={isAdmin(me)}
      aiReady={aiConfigured()}
      buildLive={buildReason === null}
      editLive={editReason === null}
      target={targetFor(targets, "linkedin")}
      accounts={(accounts.data ?? []).map((a) => ({ id: a.external_account_id, name: a.account_name ?? a.external_account_id }))}
      campaigns={history?.campaigns ?? []}
      historyTo={history?.to ?? null}
      plans={planRows}
      builds={buildRows}
      rules={rulesFor(allRules, { platform: "linkedin", clientId: client.id, mode: "general" }).concat(rulesFor(allRules, { platform: "linkedin", clientId: client.id, mode: "abx" })).filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i)}
      playbook={playbook}
      naming={naming}
      tests={(tests.data ?? []).map((t) => ({ id: t.id, title: t.title }))}
    />
  )
}
