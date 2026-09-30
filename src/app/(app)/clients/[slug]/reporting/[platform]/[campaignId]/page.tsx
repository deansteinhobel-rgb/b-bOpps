import Link from "next/link"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { getProfile } from "@/lib/auth"
import { AdThumb } from "@/components/ad-thumb"
import { PlatformLabel } from "@/components/brand"
import { cachedPerformance } from "@/lib/metrics/cached"
import { derive, fmt, METRIC, type MetricKey } from "@/lib/metrics/performance"
import { adKey, previewsFor } from "@/lib/previews"
import { createClient } from "@/lib/supabase/server"
import { Delta, Investigator, Sparkline, TrendPanel } from "../../charts"
import { CampaignDetailData } from "../../breakdowns"
import { Controls } from "../../controls"
import { parsePlatform, parseRange } from "../../params"
import { rangeParams } from "@/lib/metrics/range"
import { campaignBreakdowns } from "@/lib/metrics/breakdowns"
import { LoadedInsightSummary } from "../../../insights/summary"
import { aiConfigured } from "@/lib/ai/claude"
import { newLayout } from "@/lib/lens"
import { CampaignAskCard } from "./ask-card"
import { CampaignAsk } from "./campaign-ask"
import { canPushNegatives } from "@/lib/windsor/access"
import { windsorWritesLive } from "@/lib/windsor/mcp"
import type { PushedNegative } from "../../breakdowns"

const CARDS: MetricKey[] = ["spend", "impressions", "clicks", "ctr", "cpc", "results", "cpr"]
const AD_COLS: MetricKey[] = ["spend", "impressions", "ctr", "results", "cpr"]
const num = (v: unknown) => Number(v ?? 0)

/** One campaign: its numbers against the previous period, its trend, and every ad in it. */
export default async function CampaignPage({ params, searchParams }: PageProps<"/clients/[slug]/reporting/[platform]/[campaignId]">) {
  const { slug, platform: rawPlatform, campaignId: rawId } = await params
  const campaignId = decodeURIComponent(rawId)
  const platform = parsePlatform(rawPlatform)
  if (!platform) notFound()
  const me = await getProfile()
  const defaultDays = me.preferences?.default_days ?? 30
  const range = parseRange(await searchParams, defaultDays)
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const perf = await cachedPerformance(client.id, range, platform, campaignId) // access confirmed above
  const campaign = perf?.campaigns[0]
  if (!perf || !campaign) notFound()
  const cur = client.currency

  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const [{ data: nowAds }, { data: prevAds }, { data: tests }, detail] = await Promise.all([
    supabase.rpc("campaign_ads", { p_client: client.id, p_platform: platform, p_campaign_id: campaignId, p_from: perf.periods.from, p_to: perf.periods.to }),
    supabase.rpc("campaign_ads", { p_client: client.id, p_platform: platform, p_campaign_id: campaignId, p_from: perf.periods.prevFrom, p_to: perf.periods.prevTo }),
    supabase.from("sprint_tests").select("id, title, status, outcome, sprints(number)").eq("client_id", client.id).contains("campaign_ids", [campaignId]),
    campaignBreakdowns(supabase, client.id, platform, campaignId, perf.periods.from, perf.periods.to),
  ])
  const sums = (r: Record<string, unknown>) => derive({ spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), conversions: num(r.conversions), leads: num(r.leads) })
  const prevBy = new Map(((prevAds ?? []) as Record<string, unknown>[]).map((r) => [String(r.ad_id), sums(r)]))
  const ads = ((nowAds ?? []) as Record<string, unknown>[]).map((r) => ({
    platform,
    external_account_id: String(r.external_account_id),
    ad_id: String(r.ad_id),
    name: String(r.ad_name ?? r.ad_id),
    now: sums(r),
    prev: prevBy.get(String(r.ad_id)) ?? null,
  }))
  const previews = await previewsFor(supabase, client.id, ads)
  const negatives = platform === "google_ads" ? await negativesFor(supabase, me, client.id, slug, campaignId) : null
  const q = rangeParams(range, new URLSearchParams(), defaultDays).toString()
  const back = `/clients/${slug}/reporting${q ? `?${q}` : ""}`

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={back} className="text-xs text-muted-foreground hover:text-foreground">
          ← All campaigns
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <PlatformLabel platform={platform} className="text-sm text-muted-foreground" />
          <h2 className="text-2xl">{campaign.name}</h2>
        </div>
      </div>
      <Controls base={`/clients/${slug}/reporting/${platform}/${encodeURIComponent(campaignId)}`} range={range} defaultDays={defaultDays} platform={null} periods={perf.periods} dataFrom={perf.dataFrom} dataThrough={perf.dataThrough} />

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4 xl:grid-cols-7">
        {CARDS.map((k) => (
          <div key={k} className="bg-card px-4 py-3.5">
            <dt className="text-xs text-muted-foreground">{METRIC[k].label}</dt>
            <dd className="mt-1 font-heading text-2xl leading-none tabular-nums">{fmt(k, perf.now[k], cur)}</dd>
            <div className="mt-2 flex items-end justify-between gap-2">
              <Delta k={k} now={perf.now[k]} before={perf.prev[k]} />
              <Sparkline values={perf.daily.map((d) => d[k])} className="h-6 w-20" />
            </div>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <TrendPanel daily={perf.daily} prevDaily={perf.prevDaily} currency={cur} />
        <div className="space-y-6">
          <Suspense fallback={null}>
            <LoadedInsightSummary slug={slug} clientId={client.id} currency={cur} platform={platform} campaignId={campaignId} title="Optimise this campaign" />
          </Suspense>
          <Investigator now={perf.now} prev={perf.prev} currency={cur} />
          {(tests ?? []).length > 0 && (
            <div className="surface space-y-2 p-5">
              <h3 className="text-sm font-semibold">Sprint tests in this campaign</h3>
              <ul className="space-y-1.5 text-sm">
                {(tests ?? []).map((t) => (
                  <li key={t.id}>
                    <Link href={`/clients/${slug}/sprint?n=${(t.sprints as unknown as { number: number } | null)?.number ?? ""}#test-${t.id}`} className="hover:underline">
                      {t.title}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{t.outcome ?? t.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {newLayout(me.preferences) ? <CampaignAskCard aiReady={aiConfigured()} /> : <CampaignAsk slug={slug} platform={platform} campaignId={campaignId} aiReady={aiConfigured()} />}

      <div className="surface overflow-hidden">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">
            Ads <span className="ml-1 text-xs font-normal text-muted-foreground">{ads.length}</span>
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-normal">Ad</th>
                {AD_COLS.map((k) => (
                  <th key={k} className="px-3 py-2 text-right font-normal">
                    {METRIC[k].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {ads.map((a) => (
                <tr key={a.ad_id}>
                  <td className="max-w-96 px-4 py-2">
                    <span className="flex items-center gap-3">
                      <AdThumb preview={previews[adKey(a)]} alt={a.name} size="sm" />
                      <span className="line-clamp-2 text-sm" title={a.name}>
                        {a.name}
                      </span>
                    </span>
                  </td>
                  {AD_COLS.map((k) => (
                    <td key={k} className="px-3 py-2 text-right">
                      {fmt(k, a.now[k], cur)}
                      {a.prev && k !== "spend" && k !== "impressions" && (
                        <span className="block">
                          <Delta k={k} now={a.now[k]} before={a.prev[k]} className="text-[10px]" />
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {ads.length === 0 && (
                <tr>
                  <td colSpan={AD_COLS.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                    No ad-level data for this campaign in the period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CampaignDetailData data={detail} currency={cur} target={target} negatives={negatives} />
    </div>
  )
}

/** Negative keywords: whether you can add them, whether pushes are live, and what was already added (live pushes only). */
async function negativesFor(supabase: Awaited<ReturnType<typeof createClient>>, me: Awaited<ReturnType<typeof getProfile>>, clientId: string, slug: string, campaignId: string) {
  const [canPush, { data: log }] = await Promise.all([
    canPushNegatives(me, clientId),
    supabase.from("platform_write_log").select("payload, created_at").eq("client_id", clientId).eq("platform", "google_ads").eq("campaign_id", campaignId).eq("dry_run", false).eq("success", true).order("created_at", { ascending: false }).limit(200),
  ])
  const pushed: PushedNegative[] = []
  for (const row of log ?? []) {
    const p = (row.payload as { params?: { level?: string; ad_group_id?: string; keywords?: { text: string; match_type: string }[] } } | null)?.params
    for (const k of p?.keywords ?? []) pushed.push({ text: k.text, matchType: k.match_type, adGroupId: p?.level === "ad_group" ? (p.ad_group_id ?? null) : null, at: row.created_at as string })
  }
  return { slug, campaignId, canPush, live: windsorWritesLive(slug), pushed }
}
