import { Download } from "lucide-react"
import { notFound } from "next/navigation"
import { AdThumb, ViewAdLink } from "@/components/ad-thumb"
import { PlatformIcon, PlatformLabel } from "@/components/brand"
import { SectionHeader } from "@/components/page-header"
import { SectionNav } from "@/components/section-nav"
import { getProfile, isAdmin } from "@/lib/auth"
import { landingPages } from "@/lib/metrics/breakdowns"
import { longDate, money, percent, shortDate, whole } from "@/lib/format"
import { AD_OLD_DAYS, rankAds, type RankedAd } from "@/lib/metrics/ads"
import { cachedOverview, cachedPerformance } from "@/lib/metrics/cached"
import { isAbx } from "@/lib/metrics/live-ads-export"
import { fmt, METRIC, type MetricKey } from "@/lib/metrics/performance"
import { decodeRange, encodeRange, rangeLabel, rangeParams, rangeText } from "@/lib/metrics/range"
import { resultFieldLines } from "@/lib/metrics/result-fields"
import { parseSegment, segmentLabel, segmentOf, segmentOptions, segmentsFor, splitBySegment } from "@/lib/metrics/segments"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { Hint } from "@/components/hint"
import { adKey, previewsFor, type PreviewMap } from "@/lib/previews"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { FatiguePanel } from "../fatigue-panel"
import { PacingPanel } from "../pacing-panel"
import { BoardDeck } from "./board-deck"
import { LandingPages } from "./breakdowns"
import { CampaignTable, Delta, Investigator, PlatformSplit, Sparkline, TrendPanel } from "./charts"
import { Controls } from "./controls"
import { parsePlatform, parseRange } from "./params"
import { adsForPeriod, boardAds, buildBoard, type BoardKey } from "./boards"
import { EmbedButton, type EmbedLink } from "./embed-button"
import { ReportBoard } from "./report-board"
import { SegmentSplit } from "./segment-split"

export const metadata = { title: "Reporting" }

const CARDS: MetricKey[] = ["spend", "impressions", "clicks", "ctr", "cpc", "results", "cpr"]
const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "best-worst", label: "Best and worst ads" },
  { id: "fatigue", label: "Ad fatigue" },
  { id: "report", label: "Report" },
  { id: "deep-dive", label: "Deep dive" },
]

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
  const range = parseRange(sp, defaultDays)
  const platform = parsePlatform(sp.platform)
  // Campaign segments (e.g. Camber's SMB and ABX): narrow the whole page to one, and split them side by side.
  const segmentDefs = segmentsFor(slug)
  const segmentOpts = segmentOptions(segmentDefs)
  const segment = parseSegment(segmentDefs, sp.segment)
  const seg = segment ? { key: segment, defs: segmentDefs } : null
  const inSegment = (name: string | null) => !segment || segmentOf(segmentDefs, name) === segment
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, name, logo_url, currency, monthly_kpi_target, ga4_property_id").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  // Access confirmed above (client loaded through RLS), so the shared caches are safe to use.
  const [perf, all, unsegmented, o] = await Promise.all([
    cachedPerformance(client.id, range, platform, null, seg),
    platform ? cachedPerformance(client.id, range, null, null, seg) : null,
    // The split always shows every segment, so it needs the page without the segment filter.
    segmentDefs.length && segment ? cachedPerformance(client.id, range, platform) : null,
    cachedOverview(client.id),
  ])
  if (!perf || !o) return <p className="text-muted-foreground">No ad data yet. An admin can run a Windsor backfill for this client.</p>
  const split = segmentDefs.length ? splitBySegment(unsegmented ?? perf, segmentDefs, segmentOpts) : null
  const segmentName = segment ? segmentLabel(segmentDefs, segment) : null
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const base = `/clients/${slug}/reporting`
  const q = rangeParams(range, new URLSearchParams(), defaultDays)
  if (platform) q.set("platform", platform)
  if (segment) q.set("segment", segment)
  const query = q.toString()
  const twoDaysAgo = new Date(Date.parse(perf.dataThrough) - 864e5).toISOString().slice(0, 10)
  const { from, to, prevFrom, prevTo, compare } = perf.periods
  const dates = rangeText(from, to, perf.dataThrough)
  const against = compare ? `against ${rangeText(prevFrom, prevTo, perf.dataThrough)}` : "all time, so nothing to compare with"

  // Ads over the period: best and worst per platform, and each board's top ads.
  const [allAds, pages, { data: links }, { data: canShare }, { data: accounts }] = await Promise.all([
    adsForPeriod(supabase, client.id, from, to),
    client.ga4_property_id ? landingPages(supabase, client.id, from, to) : null,
    supabase.from("report_links").select("id, board, default_days, default_range, label, token, created_at, last_viewed_at, created_by_profile_id").eq("client_id", client.id).is("revoked_at", null).order("created_at", { ascending: false }),
    supabase.rpc("can_share_reports", { cid: client.id }),
    supabase.from("client_platform_accounts").select("platform, conversion_fields, lead_fields").eq("client_id", client.id).eq("active", true),
  ])
  // What counts as a result, per platform, for the Results and Cost per result tiles (Dean).
  const resultAccounts = (accounts ?? []).filter((a) => !platform || a.platform === platform).map((a) => ({ platform: a.platform as Platform, conversions: a.conversion_fields ?? [], leads: a.lead_fields ?? [] }))
  const resultLines = resultFieldLines(resultAccounts)
  const hasLeads = resultAccounts.some((a) => a.leads.length > 0)
  const perUnit = (spend: number, n: number) => (n > 0 ? fmt("cpr", spend / n, cur) : "–")
  const ads = allAds.filter((a) => (!platform || a.platform === platform) && inSegment(a.campaign_name))
  const rankings = rankAds(ads)

  // The boards: all platforms, then each platform (or just the one picked).
  const platformsShown = perf.platforms.filter((p) => p.now.spend > 0 || p.prev.spend > 0).sort((a, b) => b.now.spend - a.now.spend)
  const boards = platform ? [buildBoard(perf, ads, platform)] : [...(platformsShown.length > 1 ? [buildBoard(perf, ads, null)] : []), ...platformsShown.map((p) => buildBoard(perf, ads, p.platform))]

  // View-only links to the boards, for Notion.
  const creators = [...new Set((links ?? []).map((l) => l.created_by_profile_id).filter(Boolean))] as string[]
  const { data: people } = creators.length ? await supabase.from("profiles").select("id, full_name, email").in("id", creators) : { data: [] }
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name ?? p.email]))
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
  const linkViews: EmbedLink[] = (links ?? []).map((l) => ({
    id: l.id,
    board: l.board,
    opens: rangeLabel(decodeRange(l.default_range) ?? { kind: "days", days: l.default_days }),
    label: l.label,
    url: `${appUrl}/embed/report/${l.token}`,
    created: `${shortDate(l.created_at.slice(0, 10))}${nameOf.get(l.created_by_profile_id) ? ` by ${nameOf.get(l.created_by_profile_id)}` : ""}`,
    lastViewed: l.last_viewed_at ? shortDate(l.last_viewed_at.slice(0, 10)) : null,
  }))

  const liveAds = o.liveAds.filter((a) => (!platform || a.platform === platform) && inSegment(a.campaign_name))
  const newest = o.newCreatives.filter((a) => (!platform || a.platform === platform) && inSegment(a.campaign_name)).slice(0, 12)
  const sections = split ? [SECTIONS[0], { id: "segments", label: segmentDefs.map((d) => d.label).join(" vs ") }, ...SECTIONS.slice(1)] : SECTIONS
  const scopeName = [segmentName, platform ? PLATFORM_LABEL[platform] : null].filter(Boolean).join(" · ")
  const boardLabel = (p: Platform | null) => [segmentName, p ? PLATFORM_LABEL[p] : "All platforms"].filter(Boolean).join(" · ")
  const previews = await previewsFor(supabase, client.id, [...rankings.flatMap((r) => [r.best, r.worst]).filter((a) => a !== null), ...boardAds(boards, ads), ...liveAds, ...newest])

  return (
    <div className="space-y-12">
      <div className="space-y-3">
        <SectionNav sections={sections} />
        <Controls
          base={base}
          range={range}
          defaultDays={defaultDays}
          platform={platform}
          platforms={(all ?? perf).platforms.map((p) => ({ platform: p.platform as Platform, spend: p.now.spend }))}
          currency={cur}
          periods={perf.periods}
          dataFrom={perf.dataFrom}
          dataThrough={perf.dataThrough}
          segment={segment}
          segments={segmentOpts}
        />
        <p className="text-xs text-muted-foreground">
          Data through {longDate(perf.dataThrough)}. Windsor syncs daily, so figures are up to a day old. The period and platform above apply to the whole page, apart from budget pacing (this month) and ad fatigue (each ad&apos;s first and last 14 days).
          {segmentOpts.length > 0 && ` Segments come from the campaign name (${segmentDefs.map((d) => `${d.label}: ${d.hint.replace(/^Campaigns whose name /, "")}`).join("; ")}) and apply to everything apart from budget pacing and GA4 landing pages.`}
        </p>
      </div>

      {/* 1. Overview: the account, then each platform */}
      <section id="overview" className="scroll-mt-28 space-y-4">
        <SectionHeader title="Overview" description={`${scopeName || "The whole account"}, ${dates}, ${against}. Result = conversions + leads.`} />
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4 xl:grid-cols-7">
          {CARDS.map((k) => (
            <div key={k} className="bg-card px-4 py-3.5">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                {METRIC[k].label}
                {(k === "results" || k === "cpr") && resultLines.length > 0 && (
                  <Hint label="What counts as a result?">
                    A result is a conversion or a lead. {resultLines.join(". ")}.
                  </Hint>
                )}
              </dt>
              <dd className={cn("mt-1 font-heading text-2xl leading-none tabular-nums", k === "cpr" && target && perf.now.cpr !== null && (perf.now.cpr <= target ? "text-rag-green" : perf.now.cpr <= target * 1.2 ? "text-rag-amber" : "text-rag-red"))}>{fmt(k, perf.now[k], cur)}</dd>
              {k === "results" && (
                <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                  {whole(perf.now.conversions)} conv.{hasLeads && ` · ${whole(perf.now.leads)} leads`}
                </p>
              )}
              {k === "cpr" && (
                <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                  {perUnit(perf.now.spend, perf.now.conversions)} / conv.{hasLeads && ` · ${perUnit(perf.now.spend, perf.now.leads)} / lead`}
                </p>
              )}
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
                        {k === "results" && p.platform !== "google_ads" && (
                          <span className="block text-xs text-muted-foreground">
                            {whole(p.now.conversions)} conv. · {whole(p.now.leads)} leads
                          </span>
                        )}
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

      {/* 1b. Segments side by side (e.g. Camber SMB vs ABX) */}
      {split && (
        <section id="segments" className="scroll-mt-28 space-y-4">
          <SectionHeader
            title={segmentDefs.map((d) => d.label).join(" vs ")}
            description={`Each segment's campaigns added up across ${platform ? PLATFORM_LABEL[platform] : "every platform"}, ${dates}, ${against}, with each platform underneath. Pick a segment here or in the toolbar to narrow the whole page to it.`}
          />
          <SegmentSplit segments={split} currency={cur} base={base} query={q} active={segment} />
        </section>
      )}

      {/* 2. Best and worst ad */}
      <section id="best-worst" className="scroll-mt-28 space-y-4">
        <SectionHeader title="Best and worst ads" description={`${dates}. Only ads above their account's median spend. Ranked by cost per result when at least two have 3+ results, otherwise by CTR.`} />
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
          actions={
            o.liveAds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {o.liveAds.some((a) => isAbx(a.campaign_name)) && (
                  <a href={`${base}/live-ads?abx=1`} download className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground">
                    <Download className="size-3.5" aria-hidden /> Export live ABX ads
                  </a>
                )}
                <a href={`${base}/live-ads`} download className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground">
                  <Download className="size-3.5" aria-hidden /> Export all live ads
                </a>
              </div>
            )
          }
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
        <SectionHeader title="Report" description="Written for the client, one board per platform, like our Databox reports. Use ‹ › or the arrow keys to step through them, and “Embed in Notion” for a view-only link to a board." />
        <BoardDeck
          boards={boards.map((b) => ({
            key: b.key,
            label: boardLabel(b.platform),
            platform: b.platform,
            // View-only links show every campaign, so they're made from the unsegmented boards.
            actions: segment ? null : <EmbedButton key={encodeRange(range)} slug={slug} board={b.key as BoardKey} boardLabel={b.platform ? PLATFORM_LABEL[b.platform] : "All platforms"} range={range} links={linkViews.filter((l) => l.board === b.key)} canShare={Boolean(canShare)} />,
            node: <ReportBoard board={b} client={{ name: client.name, logoUrl: client.logo_url }} currency={cur} from={from} to={to} prevFrom={prevFrom} prevTo={prevTo} compare={compare} latest={perf.dataThrough} previews={previews} />,
          }))}
        />
      </section>

      {/* 5. The deep dive, for the team */}
      <section id="deep-dive" className="scroll-mt-28 space-y-6">
        <SectionHeader title="Deep dive" description={`${perf.periods.bucket === "day" ? "Day by day" : perf.periods.bucket === "week" ? "Week by week" : "Month by month"}, why the numbers moved, every campaign (click one for its ads, search terms and audiences), and landing pages.`} />
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
