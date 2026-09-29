import Link from "next/link"
import { AdThumb, ViewAdLink } from "@/components/ad-thumb"
import { PlatformIcon } from "@/components/brand"
import { Hint } from "@/components/hint"
import { money, percent, whole } from "@/lib/format"
import { AD_OLD_DAYS, type FatiguedAd, type RankedAd, type topAds } from "@/lib/metrics/ads"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { adKey, type PreviewMap } from "@/lib/previews"
import { cn } from "@/lib/utils"

const REFRESH_SHOW = 6

/**
 * At a glance's ads (Dean): which ads are working over the last 30 days, and which live ads are
 * tiring (their last two weeks worse than their first two). The full grid is in Reporting.
 */
export function AdsPanel({ slug, currency, best, tiring, unknown, previews }: { slug: string; currency: string; best: ReturnType<typeof topAds>; tiring: FatiguedAd[]; unknown: number; previews: PreviewMap }) {
  return (
    <div className="space-y-8">
      {/* Working well */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold">Working well, last 30 days</h3>
          <Hint>
            The best ads on each platform among those with real spend (above the account&apos;s middle ad). Ranked by cost per result when enough ads have results, otherwise by click-through rate: the share of
            people who saw the ad and clicked it.
          </Hint>
        </div>
        {best.length === 0 ? (
          <p className="surface px-4 py-6 text-sm text-muted-foreground">Not enough ad data in the last 30 days yet.</p>
        ) : (
          <div className="space-y-4">
            {best.map((p) => (
              <div key={p.platform} className="space-y-2">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PlatformIcon platform={p.platform} className="size-3.5" />
                  {PLATFORM_LABEL[p.platform]} · ranked by {p.basis === "cost_per_result" ? "cost per result" : "click-through rate"}
                </p>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {p.ads.map((a, i) => (
                    <BestAd key={adKey(a)} ad={a} rank={i + 1} basis={p.basis} currency={currency} previews={previews} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tiring */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold">Ads to refresh</h3>
            <Hint>
              Ad fatigue: when the same people have seen an ad many times, fewer click and each result costs more. These ads have run for over {AD_OLD_DAYS} days and did worse in their last 14 days than in their first
              14.
            </Hint>
          </div>
          <Link href={`/clients/${slug}/reporting#fatigue`} className="text-xs text-muted-foreground hover:text-foreground">
            Every live ad in Reporting →
          </Link>
        </div>
        {tiring.length === 0 ? (
          <p className="surface flex items-center gap-2 px-4 py-4 text-sm">
            <span className="size-2 rounded-full bg-rag-green" aria-hidden />
            No live ads are showing signs of fatigue.
          </p>
        ) : (
          <ul className="surface divide-y">
            {tiring.slice(0, REFRESH_SHOW).map((a) => (
              <TiringAd key={adKey(a)} ad={a} currency={currency} previews={previews} />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {tiring.length > REFRESH_SHOW && `${tiring.length - REFRESH_SHOW} more in Reporting. `}
          {unknown > 0 && `${unknown} live ad${unknown === 1 ? " was" : "s were"} already running when our data starts (90+ days), so we can't compare ${unknown === 1 ? "its" : "their"} first weeks.`}
        </p>
      </div>
    </div>
  )
}

function BestAd({ ad, rank, basis, currency, previews }: { ad: RankedAd; rank: number; basis: "cost_per_result" | "ctr"; currency: string; previews: PreviewMap }) {
  const preview = previews[adKey(ad)]
  const name = ad.ad_name ?? ad.ad_id
  return (
    <li className="surface flex gap-3 p-3">
      <div className="relative">
        <AdThumb preview={preview} alt={name} size="lg" />
        <span className={cn("absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums", rank === 1 ? "bg-lime text-primary-foreground" : "bg-secondary text-foreground")}>{rank}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug" title={name}>
          {name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground" title={ad.campaign_name ?? undefined}>
          {ad.campaign_name}
        </p>
        <p className="text-sm tabular-nums text-rag-green">{basis === "cost_per_result" ? `${money(ad.costPerResult, currency)} per result` : `${percent(ad.ctr, 2)} clicked`}</p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {whole(ad.results)} results · {whole(ad.clicks)} clicks · {money(ad.spend, currency)} spent
        </p>
        <ViewAdLink preview={preview} />
      </div>
    </li>
  )
}

function TiringAd({ ad: a, currency, previews }: { ad: FatiguedAd; currency: string; previews: PreviewMap }) {
  const preview = previews[adKey(a)]
  const name = a.ad_name ?? a.ad_id
  const signs = [
    a.ctrDown && a.ctrChangePct !== null && `Click rate down ${Math.abs(a.ctrChangePct)}% (${percent(a.earlyCtr, 2)} → ${percent(a.recentCtr, 2)})`,
    a.cprUp && (a.recentCpr === null ? `No results in the last 14 days (was ${money(a.earlyCpr, currency)} per result)` : a.cprChangePct !== null && `Each result costs ${a.cprChangePct}% more (${money(a.earlyCpr, currency)} → ${money(a.recentCpr, currency)})`),
  ].filter(Boolean) as string[]
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
      <AdThumb preview={preview} alt={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          <PlatformIcon platform={a.platform} className="size-3.5 shrink-0" />
          <span className="truncate font-medium" title={name}>
            {name}
          </span>
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          Running {a.ageDays} days · {money(a.recent_spend, currency)} spent in the last 14 days · {a.campaign_name}
        </p>
      </div>
      <ul className="col-start-2 space-y-0.5 text-xs text-rag-red md:col-start-auto md:text-right">
        {signs.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </li>
  )
}
