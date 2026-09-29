import { notFound } from "next/navigation"
import { AdThumb, ViewAdLink } from "@/components/ad-thumb"
import { PlatformIcon, PlatformLabel } from "@/components/brand"
import { SectionHeader } from "@/components/page-header"
import { SectionNav } from "@/components/section-nav"
import { getProfile, isAdmin } from "@/lib/auth"
import { landingPages } from "@/lib/metrics/breakdowns"
import { longDate, money, percent, shortDate, whole } from "@/lib/format"
import { AD_OLD_DAYS, rankAds, type AdStat, type RankedAd } from "@/lib/metrics/ads"
import { cachedOverview, cachedPerformance } from "@/lib/metrics/cached"
import { fmt, METRIC, type MetricKey } from "@/lib/metrics/performance"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { adKey, previewsFor, type PreviewMap } from "@/lib/previews"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { FatiguePanel } from "../fatigue-panel"
import { PacingPanel } from "../pacing-panel"
import { BoardDeck } from "./board-deck"
import { LandingPages } from "./breakdowns"
import { CampaignTable, Delta, Investigator, PlatformSplit, Sparkline, TrendPanel } from "./charts"
import { Controls } from "./controls"
import { parseDays, parsePlatform } from "./params"
import { platformBoardTitle, ReportBoard, type Board } from "./report-board"

export const metadata = { title: "Reporting" }

const CARDS: MetricKey[] = ["spend", "impressions", "clicks", "ctr", "cpc", "results", "cpr"]
const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "best-worst", label: "Best and worst ads" },
  { id: "fatigue", label: "Ad fatigue" },
  { id: "report", label: "Report" },
  { id: "deep-dive", label: "Deep dive" },
]
const num = (v: unknown) => Number(v ?? 0)

/**
 * Reporting (Dean, 2026-09-29; replaces the Overview and Performance tabs). One period and platform
 * for the whole page: a quick overview of the account and each platform, the best and worst ad, ad
 * fatigue in detail, then the report itself (Databox-style boards, written for the client so they
 * can be embedded in Notion later) and the deep dive for the team.
 */
export default async function ReportingPage({ params, searchParams }: PageProps<"/clients/[slug]/reporting">) {
  const { slug } = await params
  const sp = await searchParams
  const me = await getProfile()
  const defaultDays = me.preferences?.default_days ?? 30
  const days = parseDays(sp.days, defaultDays)
  const platform = parsePlatform(sp.platform)
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, name, logo_url, currency, monthly_kpi_target, ga4_property_id").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  // Access confirmed above (client loaded through RLS), so the shared caches are safe to use.
  const [perf, all, o] = await Promise.all([cachedPerformance(client.id, days, platform), platform ? cachedPerformance(client.id, days, null) : null, cachedOverview(client.id)])
  if (!perf || !o) return <p className="text-muted-foreground">No ad data yet. An admin can run a Windsor backfill for this client.</p>
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const base = `/clients/${slug}/reporting`
  const query = [days !== defaultDays && `days=${days}`, platform && `platform=${platform}`].filter(Boolean).join("&")
  const twoDaysAgo = new Date(Date.parse(perf.dataThrough) - 864e5).toISOString().slice(0, 10)
  const { from, to, prevFrom, prevTo } = perf.periods

  // Ads over the period: best and worst per platform, and each board's top ads.
  const [adRows, pages] = await Promise.all([
    rpcAll(supabase, "ad_totals", { p_client: client.id, p_from: from, p_to: to }),
    client.ga4_property_id ? landingPages(supabase, client.id, from, to) : null,
  ])
  const ads: AdStat[] = adRows
    .map((r) => ({
      platform: r.platform as Platform,
      external_account_id: String(r.external_account_id),
      ad_id: String(r.ad_id),
      ad_name: (r.ad_name as string | null) ?? null,
      campaign_name: (r.campaign_name as string | null) ?? null,
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      conversions: num(r.conversions),
      leads: num(r.leads),
    }))
    .filter((a) => !platform || a.platform === platform)
  const rankings = rankAds(ads)
  const topFor = (p: Platform | null) =>
    ads
      .filter((a) => (!p || a.platform === p) && a.spend > 0 && a.conversions + a.leads > 0)
      .sort((a, b) => b.conversions + b.leads - (a.conversions + a.leads) || a.spend - b.spend)
      .slice(0, 5)

  // The boards: all platforms, then each platform (or just the one picked).
  const platformsShown = perf.platforms.filter((p) => p.now.spend > 0 || p.prev.spend > 0).sort((a, b) => b.now.spend - a.now.spend)
  const boardOf = (p: Platform | null): Board => {
    const scope = p ? perf.platforms.find((x) => x.platform === p) : null
    return {
      key: p ?? "all",
      title: platformBoardTitle(p),
      platform: p,
      now: scope ? scope.now : perf.now,
      prev: scope ? scope.prev : perf.prev,
      campaigns: perf.campaigns.filter((c) => !p || c.platform === p).map((c) => ({ platform: c.platform, name: c.name, spend: c.now.spend, prevSpend: c.prev.spend, results: c.now.results })),
      ads: topFor(p).map((a) => ({ key: adKey(a), platform: a.platform, name: a.ad_name ?? a.ad_id, campaign: a.campaign_name, results: a.conversions + a.leads, spend: a.spend, clicks: a.clicks, impressions: a.impressions })),
    }
  }
  const boards = platform ? [boardOf(platform)] : [...(platformsShown.length > 1 ? [boardOf(null)] : []), ...platformsShown.map((p) => boardOf(p.platform))]

  const liveAds = platform ? o.liveAds.filter((a) => a.platform === platform) : o.liveAds
  const newest = o.newCreatives.filter((a) => !platform || a.platform === platform).slice(0, 12)
  const previews = await previewsFor(supabase, client.id, [...rankings.flatMap((r) => [r.best, r.worst]).filter((a) => a !== null), ...boards.flatMap((b) => b.ads.map((a) => ads.find((x) => adKey(x) === a.key)!)), ...liveAds, ...newest])

  return (
    <div className="space-y-12">
      <div className="space-y-3">
        <SectionNav sections={SECTIONS} />
        <Controls
          base={base}
          days={days}
          defaultDays={defaultDays}
          platform={platform}
          platforms={(all ?? perf).platforms.map((p) => ({ platform: p.platform as Platform, spend: p.now.spend }))}
          currency={cur}
          from={from}
          to={to}
          prevFrom={prevFrom}
          prevTo={prevTo}
        />
        <p className="text-xs text-muted-foreground">Data through {longDate(perf.dataThrough)}. Windsor syncs daily, so figures are up to a day old. The period and platform above apply to the whole page, apart from budget pacing (this month) and ad fatigue (each ad&apos;s first and last 14 days).</p>
      </div>

      {/* 1. Overview: the account, then each platform */}
      <section id="overview" className="scroll-mt-28 space-y-4">
        <SectionHeader title="Overview" description={`${platform ? PLATFORM_LABEL[platform] : "The whole account"}, ${shortDate(from)} – ${shortDate(to)}, against the ${days} days before. Result = conversions + leads.`} />
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4 xl:grid-cols-7">
          {CARDS.map((k) => (
            <div key={k} className="bg-card px-4 py-3.5">
              <dt className="text-xs text-muted-foreground">{METRIC[k].label}</dt>
              <dd className={cn("mt-1 font-heading text-2xl leading-none tabular-nums", k === "cpr" && target && perf.now.cpr !== null && (perf.now.cpr <= target ? "text-rag-green" : perf.now.cpr <= target * 1.2 ? "text-rag-amber" : "text-rag-red"))}>{fmt(k, perf.now[k], cur)}</dd>
              <div className="mt-2 flex items-end justify-between gap-2">
                <Delta k={k} now={perf.now[k]} before={perf.prev[k]} />
                <Sparkline values={perf.daily.map((d) => d[k])} className="h-6 w-20" />
              </div>
            </div>
          ))}
        </dl>
        {!platform && platformsShown.length > 1 && (
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2.5 text-left font-normal">Platform</th>
                  {(["spend", "results", "cpr", "ctr", "cpc"] as MetricKey[]).map((k) => (
                    <th key={k} className="px-4 py-2.5 text-right font-normal">
                      {METRIC[k].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {platformsShown.map((p) => (
                  <tr key={p.platform}>
                    <td className="px-4 py-3">
                      <PlatformLabel platform={p.platform} />
                    </td>
                    {(["spend", "results", "cpr", "ctr", "cpc"] as MetricKey[]).map((k) => (
                      <td key={k} className="px-4 py-3 text-right">
                        <span className={cn(k === "cpr" && target && p.now.cpr !== null && (p.now.cpr <= target ? "text-rag-green" : p.now.cpr <= target * 1.2 ? "text-rag-amber" : "text-rag-red"))}>{fmt(k, p.now[k], cur)}</span>
                        <Delta k={k} now={p.now[k]} before={p.prev[k]} className="ml-2" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="group surface overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-secondary/30">
            <span className="font-medium">Budget pacing this month</span>
            <span className="text-xs text-muted-foreground group-open:hidden">Show spend against budget{isAdmin(me) ? " and edit budgets" : ""}</span>
          </summary>
          <div className="border-t p-4">
            <PacingPanel platforms={o.pacing} campaigns={o.campaignPacing} currency={cur} month={o.month} canEdit={isAdmin(me)} clientSlug={slug} />
          </div>
        </details>
      </section>

      {/* 2. Best and worst ad */}
      <section id="best-worst" className="scroll-mt-28 space-y-4">
        <SectionHeader title="Best and worst ads" description={`${shortDate(from)} – ${shortDate(to)}. Only ads above their account's median spend. Ranked by cost per result when at least two have 3+ results, otherwise by CTR.`} />
        {rankings.length === 0 ? (
          <p className="surface px-4 py-6 text-sm text-muted-foreground">Not enough ad data in this period.</p>
        ) : (
          <div className="surface divide-y">
            {rankings.map((r) => (
              <div key={r.platform} className="grid gap-4 p-4 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
                <div className="text-sm">
                  <PlatformLabel platform={r.platform} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    By {r.basis === "cost_per_result" ? "cost per result" : "CTR"} · {r.eligible} eligible ad{r.eligible === 1 ? "" : "s"}
                  </p>
                </div>
                <AdLine label="Best" ad={r.best} basis={r.basis} currency={cur} previews={previews} />
                <AdLine label="Worst" ad={r.worst} basis={r.basis} currency={cur} previews={previews} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. Ad fatigue in detail */}
      <section id="fatigue" className="scroll-mt-28 space-y-4">
        <SectionHeader
          title="Ad fatigue"
          description={`Every live ad: its first 14 days against its last 14 days. First seen is red when it's over ${AD_OLD_DAYS} days ago; the last 14 days are red when worse. Age counts from the first day with impressions in our data (from ${longDate(o.dataFrom)}), because Windsor can't see creative edits.`}
        />
        <FatiguePanel ads={liveAds} previews={previews} currency={cur} />
        <div className="space-y-3">
          <h3 className="text-base font-semibold">New creatives this month</h3>
          {newest.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {newest.map((a) => (
                <li key={adKey(a)} className="surface overflow-hidden transition-colors hover:border-foreground/20">
                  <AdThumb preview={previews[adKey(a)]} alt={a.ad_name ?? a.ad_id} size="card" className="rounded-none border-0 border-b" />
                  <div className="space-y-1.5 p-3">
                    <p className="line-clamp-2 min-h-[2lh] text-xs font-medium leading-snug" title={a.ad_name ?? a.ad_id}>
                      {a.ad_name ?? a.ad_id}
                    </p>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <PlatformIcon platform={a.platform} className="size-3.5" />
                      <span className="min-w-0 flex-1 truncate">First seen {shortDate(a.first_seen)}</span>
                      <span className={cn("size-1.5 shrink-0 rounded-full", a.live ? "bg-rag-green" : "bg-rag-na")} title={a.live ? "Live" : "Not live"} aria-label={a.live ? "Live" : "Not live"} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 4. The report: client-facing boards */}
      <section id="report" className="scroll-mt-28 space-y-4">
        <SectionHeader title="Report" description="Written for the client, one board per platform, like our Databox reports. Use ‹ › or the arrow keys to step through them." />
        <BoardDeck
          boards={boards.map((b) => ({
            key: b.key,
            label: b.platform ? PLATFORM_LABEL[b.platform] : "All platforms",
            platform: b.platform,
            node: <ReportBoard board={b} client={{ name: client.name, logoUrl: client.logo_url }} currency={cur} from={from} to={to} prevFrom={prevFrom} prevTo={prevTo} previews={previews} />,
          }))}
        />
      </section>

      {/* 5. The deep dive, for the team */}
      <section id="deep-dive" className="scroll-mt-28 space-y-6">
        <SectionHeader title="Deep dive" description="Day by day, why the numbers moved, every campaign (click one for its ads, search terms and audiences), and landing pages." />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <TrendPanel daily={perf.daily} prevDaily={perf.prevDaily} currency={cur} />
          <div className="space-y-6">
            <Investigator now={perf.now} prev={perf.prev} currency={cur} />
            {!platform && <PlatformSplit platforms={perf.platforms} currency={cur} />}
          </div>
        </div>
        <CampaignTable slug={slug} currency={cur} target={target} query={query ? `?${query}` : ""} rows={perf.campaigns.map((c) => ({ ...c, live: Boolean(c.lastSpendDate && c.lastSpendDate >= twoDaysAgo) }))} />
        {pages && <LandingPages rows={pages} />}
      </section>
    </div>
  )
}

function AdLine({ label, ad, basis, currency, previews }: { label: "Best" | "Worst"; ad: RankedAd | null; basis: "cost_per_result" | "ctr"; currency: string; previews: PreviewMap }) {
  if (!ad) return <p className="text-sm text-muted-foreground">{label}: not enough eligible ads</p>
  const preview = previews[adKey(ad)]
  return (
    <div className="flex gap-3">
      <AdThumb preview={preview} alt={ad.ad_name ?? ad.ad_id} size="lg" />
      <div className="min-w-0 space-y-1 text-sm">
        <p className={cn("text-xs font-medium", label === "Best" ? "text-rag-green" : "text-rag-red")}>{label}</p>
        <p className="line-clamp-2 font-medium leading-snug" title={ad.ad_name ?? ad.ad_id}>
          {ad.ad_name ?? ad.ad_id}
        </p>
        <p className="line-clamp-1 text-xs text-muted-foreground">{ad.campaign_name}</p>
        <p className="tabular-nums">{basis === "cost_per_result" ? `${money(ad.costPerResult, currency)} per result` : `${percent(ad.ctr, 2)} CTR`}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {money(ad.spend, currency)} spend · {whole(ad.results)} results · {whole(ad.clicks)} clicks
        </p>
        <ViewAdLink preview={preview} />
      </div>
    </div>
  )
}
