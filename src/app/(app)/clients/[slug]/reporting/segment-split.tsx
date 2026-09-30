import Link from "next/link"
import { AdThumb } from "@/components/ad-thumb"
import { PlatformIcon, PlatformLabel } from "@/components/brand"
import { money, percent, whole } from "@/lib/format"
import type { AdStat } from "@/lib/metrics/ads"
import { fmt, METRIC, type MetricKey } from "@/lib/metrics/performance"
import type { SegmentOption, SegmentTotals } from "@/lib/metrics/segments"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { adKey, type PreviewMap } from "@/lib/previews"
import { cn } from "@/lib/utils"
import { Delta } from "./charts"

const ROWS: MetricKey[] = ["spend", "results", "cpr", "ctr", "cpc"]
const ADS_SHOWN = 10

const tint = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, transparent)`

/** A link to the page with this segment and platform picked (null clears either), landing on the detail. */
function viewHref(base: string, query: URLSearchParams, segment: string | null, platform: Platform | null, anchor = "segment-detail") {
  const q = new URLSearchParams(query)
  if (segment) q.set("segment", segment)
  else q.delete("segment")
  if (platform) q.set("platform", platform)
  else q.delete("platform")
  return `${base}${q.size ? `?${q}` : ""}#${anchor}`
}

/**
 * SMB vs ABX (Dean, 2026-09-30): each segment's campaigns added up across every platform, side by
 * side in its own color, with a row per platform. Clicking a segment or one of its platforms picks
 * it for the whole page and opens its campaigns and ads underneath (`SegmentDetail`).
 */
export function SegmentSplit({ segments, currency, base, query, active, platform }: { segments: SegmentTotals[]; currency: string; base: string; query: URLSearchParams; active: string | null; platform: Platform | null }) {
  const total = segments.reduce((s, x) => s + x.now.spend, 0)
  return (
    <div className="surface overflow-hidden">
      {total > 0 && (
        <div className="space-y-2 border-b px-4 py-3">
          <p className="text-xs text-muted-foreground">Share of spend, all platforms</p>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {segments.map((s) => (s.now.spend > 0 ? <div key={s.key} className="first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.now.spend / total) * 100}%`, background: s.color }} title={`${s.label}: ${Math.round((s.now.spend / total) * 100)}%`} /> : null))}
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {segments.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 tabular-nums">
                <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label} {total > 0 ? Math.round((s.now.spend / total) * 100) : 0}%
              </span>
            ))}
          </p>
        </div>
      )}
      <div className={cn("grid divide-y", segments.length >= 3 ? "xl:grid-cols-3 xl:divide-x xl:divide-y-0" : "lg:grid-cols-2 lg:divide-x lg:divide-y-0")}>
        {segments.map((s) => {
          const on = active === s.key
          return (
            <div key={s.key} className="relative space-y-4 p-4" style={on ? { background: tint(s.color, 8) } : undefined}>
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: s.color, opacity: on || !active ? 1 : 0.45 }} aria-hidden />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold" style={{ color: s.color }}>
                    <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.hint}</p>
                </div>
                {on && !platform ? (
                  <Link href={viewHref(base, query, null, null, "segments")} scroll={false} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
                    Show all
                  </Link>
                ) : (
                  <Link href={viewHref(base, query, s.key, null)} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-secondary" style={{ color: s.color }}>
                    See {s.label} →
                  </Link>
                )}
              </div>
              <dl className="grid grid-cols-3 gap-x-3 gap-y-3 sm:grid-cols-5 xl:grid-cols-3 2xl:grid-cols-5">
                {ROWS.map((k) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k === "cpr" ? "Cost / result" : METRIC[k].label}</dt>
                    <dd className="mt-0.5 font-heading text-xl leading-tight tabular-nums">{fmt(k, s.now[k], currency)}</dd>
                    <Delta k={k} now={s.now[k]} before={s.prev[k]} />
                  </div>
                ))}
              </dl>
              {s.platforms.length > 0 && (
                <div className="text-sm tabular-nums">
                  <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_3.5rem_4.5rem_0.75rem] gap-2 border-b py-1.5 text-xs text-muted-foreground">
                    <span>Platform</span>
                    <span className="text-right">Spend</span>
                    <span className="text-right">Results</span>
                    <span className="text-right">Cost / result</span>
                    <span />
                  </div>
                  <ul className="divide-y">
                    {s.platforms.map((p) => {
                      const here = on && platform === p.platform
                      return (
                        <li key={p.platform}>
                          <Link
                            href={viewHref(base, query, s.key, p.platform)}
                            title={`${s.label} campaigns and ads on ${PLATFORM_LABEL[p.platform]}`}
                            aria-current={here ? "true" : undefined}
                            className="-mx-2 grid grid-cols-[minmax(0,1fr)_4.5rem_3.5rem_4.5rem_0.75rem] items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-secondary/70"
                            style={here ? { background: tint(s.color, 18), boxShadow: `inset 3px 0 0 ${s.color}` } : undefined}
                          >
                            <span className="min-w-0 truncate"><PlatformLabel platform={p.platform} /></span>
                            <span className="text-right">{money(p.now.spend, currency)}</span>
                            <span className="text-right">{whole(p.now.results)}</span>
                            <span className="text-right">{fmt("cpr", p.now.cpr, currency)}</span>
                            <span className="text-right text-muted-foreground" aria-hidden>
                              ›
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The picked segment's campaigns and ads (Dean: click Meta or LinkedIn and see only that segment's
 * campaigns and ads), with a tab per platform the segment runs on.
 */
export function SegmentDetail({ segment, platform, platforms, base, query, children }: { segment: SegmentOption; platform: Platform | null; platforms: Platform[]; base: string; query: URLSearchParams; children: React.ReactNode }) {
  const tabs: (Platform | null)[] = [null, ...platforms]
  return (
    <div id="segment-detail" className="scroll-mt-28 space-y-4 rounded-lg border p-4" style={{ borderColor: tint(segment.color, 45), background: tint(segment.color, 4) }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <span className="size-2.5 rounded-full" style={{ background: segment.color }} aria-hidden />
          <span style={{ color: segment.color }}>{segment.label}</span>
          <span className="text-muted-foreground">·</span>
          {platform ? PLATFORM_LABEL[platform] : "All platforms"}
        </h3>
        <nav className="flex flex-wrap items-center gap-1" aria-label={`${segment.label} by platform`}>
          {tabs.map((p) => {
            const here = p === platform
            return (
              <Link
                key={p ?? "all"}
                href={viewHref(base, query, segment.key, p)}
                scroll={false}
                aria-current={here ? "page" : undefined}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors", here ? "text-foreground" : "border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground")}
                style={here ? { background: tint(segment.color, 16), borderColor: tint(segment.color, 55) } : undefined}
              >
                {p && <PlatformIcon platform={p} className="size-3.5" />}
                {p ? PLATFORM_LABEL[p] : "All platforms"}
              </Link>
            )
          })}
          <Link href={viewHref(base, query, null, platform, "segments")} scroll={false} className="ml-1 px-2 text-xs text-muted-foreground hover:text-foreground">
            Clear
          </Link>
        </nav>
      </div>
      {children}
    </div>
  )
}

/** Every ad in the segment over the period, biggest spend first. */
export function SegmentAds({ ads, previews, currency }: { ads: AdStat[]; previews: PreviewMap; currency: string }) {
  const sorted = ads.filter((a) => a.spend > 0 || a.impressions > 0).sort((a, b) => b.spend - a.spend)
  if (!sorted.length) return <p className="surface px-4 py-6 text-sm text-muted-foreground">No ads with spend in this period.</p>
  const row = (a: AdStat) => {
    const results = a.conversions + a.leads
    return (
      <li key={adKey(a)} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 sm:grid-cols-[3rem_minmax(0,1fr)_repeat(4,5.5rem)]">
        <AdThumb preview={previews[adKey(a)]} alt={a.ad_name ?? a.ad_id} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={a.ad_name ?? a.ad_id}>
            {a.ad_name ?? a.ad_id}
          </p>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground" title={a.campaign_name ?? ""}>
            <PlatformIcon platform={a.platform} className="size-3.5 shrink-0" />
            <span className="truncate">{a.campaign_name}</span>
          </p>
        </div>
        <span className="col-start-2 text-xs tabular-nums text-muted-foreground sm:col-start-auto sm:text-right sm:text-sm sm:text-foreground">
          {money(a.spend, currency)}
          <span className="sm:hidden"> · {whole(results)} results · {results ? money(a.spend / results, currency) : "–"} each</span>
        </span>
        <span className="hidden text-right text-sm tabular-nums sm:block">{whole(results)}</span>
        <span className="hidden text-right text-sm tabular-nums sm:block">{results ? money(a.spend / results, currency) : "–"}</span>
        <span className="hidden text-right text-sm tabular-nums sm:block">{a.impressions ? percent(a.clicks / a.impressions, 2) : "–"}</span>
      </li>
    )
  }
  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">
          Ads <span className="ml-1 text-xs font-normal text-muted-foreground">{sorted.length}</span>
        </h3>
      </div>
      <div className="hidden grid-cols-[3rem_minmax(0,1fr)_repeat(4,5.5rem)] gap-3 border-b px-4 py-2 text-xs text-muted-foreground sm:grid">
        <span />
        <span>Ad</span>
        <span className="text-right">Spend</span>
        <span className="text-right">Results</span>
        <span className="text-right">Cost / result</span>
        <span className="text-right">CTR</span>
      </div>
      <ul className="divide-y">{sorted.slice(0, ADS_SHOWN).map(row)}</ul>
      {sorted.length > ADS_SHOWN && (
        <details className="group border-t">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-xs text-muted-foreground hover:bg-secondary/30 hover:text-foreground">
            <span className="group-open:hidden">Show {sorted.length - ADS_SHOWN} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="divide-y border-t">{sorted.slice(ADS_SHOWN).map(row)}</ul>
        </details>
      )}
    </div>
  )
}
