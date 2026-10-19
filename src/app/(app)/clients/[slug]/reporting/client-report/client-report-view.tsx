import { AdThumb } from "@/components/ad-thumb"
import { ClientLogo, PlatformIcon } from "@/components/brand"
import { money, percent, whole } from "@/lib/format"
import type { ReportAd } from "@/lib/metrics/client-report"
import { assetName, type AssetPick, type AssetSection } from "@/lib/metrics/assets"
import { rangeText } from "@/lib/metrics/range"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { adKey } from "@/lib/previews"
import { cn } from "@/lib/utils"
import { Chip } from "../report-board"
import type { ClientReportData } from "./data"

type Tile = { label: string; caption: string; now: number | null; prev: number | null; show: (v: number | null) => string; better: "up" | "down" | "none"; target?: number | null }

/**
 * The client report itself (Dean, 2026-10-19): written for the client, so plain words and no
 * internal notes. Headline numbers against the period before, the 3 strongest and 3 weakest ads,
 * then what happened in a few sentences. The app page and the shared link both render it.
 */
export function ClientReportView({ data: d, client, currency, note }: { data: ClientReportData; client: { name: string; logoUrl: string | null }; currency: string; note?: string | null }) {
  const m = (v: number | null, digits = 0) => money(v, currency, digits)
  const { from, to, prevFrom, prevTo, compare } = d.periods
  const leads = d.platform !== "google_ads"
  const tiles: Tile[] = [
    { label: "Spend", caption: "Paid to the ad platforms", now: d.now.spend, prev: d.prev.spend, show: (v) => m(v), better: "none" },
    { label: "Clicks", caption: "Times people clicked an ad", now: d.now.clicks, prev: d.prev.clicks, show: whole, better: "up" },
    { label: "Cost per click", caption: "Spend ÷ clicks", now: d.now.cpc, prev: d.prev.cpc, show: (v) => m(v, 2), better: "down" },
    { label: "Conversions", caption: "Actions taken on your website", now: d.now.conversions, prev: d.prev.conversions, show: whole, better: "up" },
    ...(leads ? [{ label: "Leads", caption: "Lead forms filled in on the platform", now: d.now.leads, prev: d.prev.leads, show: whole, better: "up" } as Tile] : []),
    { label: "Cost per result", caption: leads ? "Spend ÷ (conversions + leads)" : "Spend ÷ conversions", now: d.now.cpr, prev: d.prev.cpr, show: (v) => m(v), better: "down", target: d.target },
  ]
  const ctrBasis = d.picks.basis === "ctr"

  return (
    <article className="surface overflow-hidden" aria-label={`${d.title} report`}>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <ClientLogo name={client.name} logoUrl={client.logoUrl} size="lg" />
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-heading text-2xl leading-tight">
              {d.platform && <PlatformIcon platform={d.platform} className="size-5 shrink-0" />}
              <span className="truncate" title={d.title}>
                {d.title}
              </span>
            </h2>
            <p className="text-[13px] text-muted-foreground">
              {client.name} · {d.scope.campaign ? `${PLATFORM_LABEL[d.scope.campaign.platform]} campaign` : d.platform ? "Every campaign" : "Every platform and campaign"}
            </p>
          </div>
        </div>
        <p className="text-right text-[13px] text-muted-foreground">
          <span className="block text-base text-foreground">{rangeText(from, to, d.dataThrough)}</span>
          {compare ? `compared with ${rangeText(prevFrom, prevTo, d.dataThrough)}` : "all time"}
        </p>
      </header>

      {/* The headline numbers */}
      <section aria-labelledby="cr-overview">
        <h3 id="cr-overview" className="sr-only">
          Overview
        </h3>
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
          {tiles.map((t, i) => (
            // Five tiles (Google Ads has no leads): stretch one so the grid has no gap.
            <div key={t.label} className={cn("bg-card px-5 py-5", tiles.length === 5 && i === 0 && "col-span-2 sm:col-span-1", tiles.length === 5 && i === 4 && "sm:col-span-2")}>
              <dt className="text-[13px] font-medium">{t.label}</dt>
              <dd className="mt-2 font-heading text-3xl leading-none tabular-nums">{t.show(t.now)}</dd>
              {compare && (
                <dd className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                  <Chip now={t.now} prev={t.prev} better={t.better} />
                  <span className="tabular-nums">was {t.show(t.prev)}</span>
                </dd>
              )}
              <dd className="mt-1 text-xs text-subtle-foreground">
                {t.caption}
                {t.target ? ` · target ${m(t.target)}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {d.assets ? (
        d.assets.map((s) => (
          <AssetList key={s.key} section={s} currency={currency} />
        ))
      ) : d.adsWithSpend === 0 ? (
        <section aria-labelledby="cr-ads" className="border-t px-5 py-5 sm:px-6">
          <h3 id="cr-ads" className="text-base font-semibold">
            Ads
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">No ad-level numbers for these dates. Some campaign types, such as Performance Max, only report for the whole campaign.</p>
        </section>
      ) : (
        <>
          <AdList
            id="cr-best"
            title="Top performing ads"
            caption={ctrBasis ? "The ads people clicked most often, among the ads that spent the most." : "The ads that brought results at the lowest cost, among the ads that spent the most."}
            ads={d.picks.best}
            empty="Not enough ad activity in these dates to pick the strongest ads."
            data={d}
            currency={currency}
            tone="good"
          />
          <AdList
            id="cr-worst"
            title="Ads to improve"
            caption={ctrBasis ? "The ads people clicked least often, among the ads that spent the most." : "The ads with the highest cost per result (or none yet), among the ads that spent the most."}
            ads={d.picks.worst}
            empty={d.picks.best.length ? "Too few ads ran in these dates to single out weaker ones." : "Not enough ad activity in these dates to compare ads."}
            data={d}
            currency={currency}
            tone="bad"
          />
        </>
      )}

      {/* What happened */}
      <section aria-labelledby="cr-summary" className="border-t px-5 py-5 sm:px-6">
        <h3 id="cr-summary" className="text-base font-semibold">
          What happened
        </h3>
        <ul className="mt-3 max-w-3xl space-y-2 text-[15px] leading-relaxed text-body">
          {d.summary.map((s) => (
            <li key={s} className="flex gap-3">
              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-lime" aria-hidden />
              <span>{s}</span>
            </li>
          ))}
        </ul>
        {note && (
          <div className="mt-5 max-w-3xl rounded-lg border px-4 py-3">
            <p className="text-[13px] font-medium">A note from your team</p>
            <p className="mt-1 text-[15px] leading-relaxed whitespace-pre-line text-body">{note}</p>
          </div>
        )}
      </section>
    </article>
  )
}

function AdList({ id, title, caption, ads, empty, data: d, currency, tone }: { id: string; title: string; caption: string; ads: ReportAd[]; empty: string; data: ClientReportData; currency: string; tone: "good" | "bad" }) {
  const m = (v: number | null) => money(v, currency, v !== null && v < 100 ? 2 : 0)
  const ctrBasis = d.picks.basis === "ctr"
  return (
    <section aria-labelledby={id} className="border-t px-5 py-5 sm:px-6">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{caption}</p>
      {ads.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ads.map((a, i) => {
            const name = a.ad_name ?? a.ad_id
            const stats = [
              { label: "Results", value: whole(a.results), key: !ctrBasis },
              { label: "Cost per result", value: a.costPerResult === null ? "None yet" : m(a.costPerResult), key: !ctrBasis },
              { label: "Click-through rate", value: a.ctr === null ? "–" : percent(a.ctr, 2), key: ctrBasis },
              { label: "Spend", value: m(a.spend), key: false },
            ]
            return (
              <li key={adKey(a)} className="flex flex-col overflow-hidden rounded-xl border bg-background/40">
                <div className="relative">
                  <AdThumb preview={d.previews[adKey(a)]} alt={name} size="card" className="rounded-none border-0 border-b" />
                  <span className={cn("absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", tone === "good" ? "bg-rag-green text-black" : "bg-rag-red text-black")}>{i + 1}</span>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm leading-snug font-medium" title={name}>
                      {name}
                    </p>
                    {a.campaign_name && (
                      <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground" title={a.campaign_name}>
                        {!d.platform && <PlatformIcon platform={a.platform} className="size-3 shrink-0" />}
                        {a.campaign_name}
                      </p>
                    )}
                  </div>
                  <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    {stats.map((s) => (
                      <div key={s.label}>
                        <dt className="text-muted-foreground">{s.label}</dt>
                        <dd className={cn("text-sm tabular-nums", s.key && (tone === "good" ? "text-rag-green" : "text-rag-red"))}>{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/**
 * One asset type for a Performance Max or Demand Gen campaign (images, then headlines): the top 3
 * and the weakest 3, compared with each other only, because Google mixes assets into every ad.
 */
function AssetList({ section: s, currency }: { section: AssetSection; currency: string }) {
  const ctrBasis = s.basis === "ctr"
  const id = `cr-assets-${s.key}`
  return (
    <section aria-labelledby={id} className="border-t px-5 py-5 sm:px-6">
      <h3 id={id} className="text-base font-semibold">
        {s.label}
      </h3>
      <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">
        This campaign builds its ads from {s.label.toLowerCase()}, text and other assets that Google mixes together, so each {s.one}&apos;s numbers include the ads it appeared in.{" "}
        {ctrBasis ? `Ranked by how often people clicked, among the ${s.label.toLowerCase()} that spent the most.` : `Ranked by cost per result, among the ${s.label.toLowerCase()} that spent the most.`}
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <AssetColumn title={`Top ${s.label.toLowerCase()}`} list={s.best} section={s} currency={currency} tone="good" empty={`Not enough activity to pick the strongest ${s.label.toLowerCase()}.`} />
        <AssetColumn title={`${s.label} to improve`} list={s.worst} section={s} currency={currency} tone="bad" empty={`Too few ${s.label.toLowerCase()} ran to single out weaker ones.`} />
      </div>
    </section>
  )
}

function AssetColumn({ title, list, section: s, currency, tone, empty }: { title: string; list: AssetPick[]; section: AssetSection; currency: string; tone: "good" | "bad"; empty: string }) {
  const m = (v: number | null) => money(v, currency, v !== null && v < 100 ? 2 : 0)
  const ctrBasis = s.basis === "ctr"
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-2 divide-y rounded-xl border bg-background/40">
          {list.map((p, i) => (
            <li key={p.asset.key} className="flex items-center gap-3 px-3 py-3">
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", tone === "good" ? "bg-rag-green text-black" : "bg-rag-red text-black")}>{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- Google-hosted asset images (in the CSP) */}
              {p.asset.imageUrl && <img src={p.asset.imageUrl} alt={`${s.one} ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" className="h-14 w-20 shrink-0 rounded-md border bg-elevated object-contain" />}
              <span className="min-w-0 flex-1">
                {(p.asset.text || p.asset.videoTitle) && (
                  <span className="line-clamp-2 text-sm leading-snug font-medium" title={assetName(p.asset)}>
                    {assetName(p.asset)}
                  </span>
                )}
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                  {ctrBasis ? (
                    <span className={cn(tone === "good" ? "text-rag-green" : "text-rag-red")}>{p.ctr === null ? "–" : percent(p.ctr, 2)} click-through</span>
                  ) : (
                    <>
                      <span className={cn(tone === "good" ? "text-rag-green" : "text-rag-red")}>{p.costPerResult === null ? "No results yet" : `${m(p.costPerResult)} per result`}</span>
                      <span>{whole(p.results)} {Math.round(p.results) === 1 ? "result" : "results"}</span>
                    </>
                  )}
                  <span>{m(p.spend)} spend</span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
