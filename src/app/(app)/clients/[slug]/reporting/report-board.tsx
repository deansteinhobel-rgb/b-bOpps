import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { AdThumb } from "@/components/ad-thumb"
import { ClientLogo, PlatformIcon } from "@/components/brand"
import { money, percent, whole } from "@/lib/format"
import { change, type Derived } from "@/lib/metrics/performance"
import { rangeText } from "@/lib/metrics/range"
import type { Platform } from "@/lib/metrics/types"
import type { PreviewMap } from "@/lib/previews"
import { cn } from "@/lib/utils"
import { PLATFORM_COLOR } from "./charts"

export type BoardCampaign = { platform: Platform; name: string; spend: number; prevSpend: number; results: number }
export type BoardAd = { key: string; platform: Platform; name: string; campaign: string | null; results: number; spend: number; clicks: number; impressions: number }
export type Board = {
  key: string
  title: string
  platform: Platform | null
  now: Derived
  prev: Derived
  campaigns: BoardCampaign[]
  ads: BoardAd[]
}

type Tile = { label: string; caption: string; now: number | null; prev: number | null; kind: "money" | "count" | "percent"; better: "up" | "down" | "none" }

const show = (kind: Tile["kind"], v: number | null, currency: string) => (v === null ? "–" : kind === "money" ? money(v, currency, v < 100 ? 2 : 0) : kind === "percent" ? percent(v, 2) : whole(v))

/**
 * One report board, Databox style (Dean, 2026-09-29): written for the client, so it can later be
 * embedded on a Notion page. The period's headline numbers against the previous period, where the
 * money went, which campaigns brought results, and the ads that did best. No internal notes.
 */
export function ReportBoard({ board: b, client, currency, from, to, prevFrom, prevTo, compare = true, latest, previews }: { board: Board; client: { name: string; logoUrl: string | null }; currency: string; from: string; to: string; prevFrom: string; prevTo: string; compare?: boolean; latest: string; previews: PreviewMap }) {
  const leadsMatter = b.platform !== "google_ads" && (b.now.leads > 0 || b.prev.leads > 0)
  const tiles: Tile[] = [
    { label: "Spend", caption: "Paid to the ad platform", now: b.now.spend, prev: b.prev.spend, kind: "money", better: "none" },
    { label: "Impressions", caption: "Times our ads were shown", now: b.now.impressions, prev: b.prev.impressions, kind: "count", better: "up" },
    { label: "Clicks", caption: "People who clicked an ad", now: b.now.clicks, prev: b.prev.clicks, kind: "count", better: "up" },
    { label: "Click-through rate", caption: "Share of views that led to a click", now: b.now.ctr, prev: b.prev.ctr, kind: "percent", better: "up" },
    { label: "Cost per click", caption: "Spend ÷ clicks", now: b.now.cpc, prev: b.prev.cpc, kind: "money", better: "down" },
    ...(leadsMatter
      ? ([
          { label: "Conversions", caption: "Actions on the website", now: b.now.conversions, prev: b.prev.conversions, kind: "count", better: "up" },
          { label: "Leads", caption: "Forms filled in on the platform", now: b.now.leads, prev: b.prev.leads, kind: "count", better: "up" },
        ] as Tile[])
      : ([{ label: "Conversions", caption: "Actions on the website", now: b.now.results, prev: b.prev.results, kind: "count", better: "up" }] as Tile[])),
    { label: "Cost per result", caption: leadsMatter ? "Spend ÷ (conversions + leads)" : "Spend ÷ conversions", now: b.now.cpr, prev: b.prev.cpr, kind: "money", better: "down" },
  ]
  const campaigns = b.campaigns.filter((c) => c.spend > 0 || c.prevSpend > 0)
  const byResults = campaigns.filter((c) => c.results > 0).sort((a, c) => c.results - a.results)
  const maxResults = Math.max(...byResults.map((c) => c.results), 1)
  const color = b.platform ? PLATFORM_COLOR[b.platform] : "var(--lime)"

  return (
    <article className="surface overflow-hidden" aria-label={b.title}>
      {/* Header: who, what, when */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <ClientLogo name={client.name} logoUrl={client.logoUrl} size="sm" />
          <div>
            <p className="flex items-center gap-2 text-base font-semibold">
              {b.platform && <PlatformIcon platform={b.platform} />}
              {b.title}
            </p>
            <p className="text-xs text-muted-foreground">{client.name}</p>
          </div>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          <span className="block text-foreground">{rangeText(from, to, latest)}</span>
          {compare ? `compared with ${rangeText(prevFrom, prevTo, latest)}` : "all time"}
        </p>
      </header>

      {/* Headline numbers */}
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {tiles.map((t, i) => (
          // Seven tiles: Spend takes two cells so the grid has no gap.
          <div key={t.label} className={cn("bg-card px-4 py-4", i === 0 && tiles.length % 2 === 1 && "col-span-2")}>
            <dt className="text-xs font-medium">{t.label}</dt>
            <dd className="mt-2 font-heading text-3xl leading-none tabular-nums">{show(t.kind, t.now, currency)}</dd>
            {compare && (
              <dd className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                <Chip now={t.now} prev={t.prev} better={t.better} />
                <span className="tabular-nums">was {show(t.kind, t.prev, currency)}</span>
              </dd>
            )}
            <dd className="mt-1 text-[11px] text-subtle-foreground">{t.caption}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-px border-t bg-border lg:grid-cols-2">
        {/* Spend by campaign */}
        <section className="bg-card">
          <h3 className="px-5 pt-4 pb-2 text-sm font-semibold">Spend by campaign</h3>
          {campaigns.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No spend in this period.</p>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <thead className="text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-5 py-1.5 text-left font-normal">Campaign</th>
                  <th className="px-3 py-1.5 text-right font-normal">Spend</th>
                  {compare && <th className="px-5 py-1.5 text-right font-normal">vs before</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {campaigns.slice(0, 8).map((c) => (
                  <tr key={`${c.platform}|${c.name}`}>
                    <td className="max-w-0 px-5 py-2">
                      <span className="flex items-center gap-2">
                        {!b.platform && <PlatformIcon platform={c.platform} className="size-3.5 shrink-0" />}
                        <span className="truncate" title={c.name}>
                          {c.name}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{money(c.spend, currency)}</td>
                    {compare && (
                      <td className="px-5 py-2 text-right">
                        <Chip now={c.spend} prev={c.prevSpend} better="none" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t text-muted-foreground">
                  <td className="px-5 py-2">{campaigns.length > 8 ? `Total (${campaigns.length} campaigns)` : "Total"}</td>
                  <td className="px-3 py-2 text-right text-foreground">{money(b.now.spend, currency)}</td>
                  {compare && (
                    <td className="px-5 py-2 text-right">
                      <Chip now={b.now.spend} prev={b.prev.spend} better="none" />
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        {/* Results by campaign */}
        <section className="bg-card">
          <h3 className="flex items-baseline justify-between gap-2 px-5 pt-4 pb-2 text-sm font-semibold">
            Results by campaign
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{whole(b.now.results)} in total</span>
          </h3>
          {byResults.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No results in this period.</p>
          ) : (
            <ul className="space-y-2.5 px-5 pt-1 pb-5">
              {byResults.slice(0, 7).map((c) => (
                <li key={`${c.platform}|${c.name}`} className="space-y-1 text-sm" title={`${c.name}: ${whole(c.results)} results, ${c.spend && c.results ? money(c.spend / c.results, currency) : "–"} each`}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      {!b.platform && <PlatformIcon platform={c.platform} className="size-3.5 shrink-0" />}
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {whole(c.results)} <span className="text-xs text-muted-foreground">({Math.round((c.results / Math.max(b.now.results, 1)) * 100)}%)</span>
                    </span>
                  </span>
                  <span className="block h-2 rounded-full bg-secondary" aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${(c.results / maxResults) * 100}%`, backgroundColor: b.platform ? color : PLATFORM_COLOR[c.platform] }} />
                  </span>
                </li>
              ))}
              {byResults.length > 7 && <li className="text-xs text-muted-foreground">and {byResults.length - 7} more campaigns with {whole(byResults.slice(7).reduce((s, c) => s + c.results, 0))} results</li>}
            </ul>
          )}
        </section>
      </div>

      {/* Top ads */}
      <section className="border-t">
        <h3 className="px-5 pt-4 pb-2 text-sm font-semibold">Top performing ads</h3>
        {b.ads.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No ads with results in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm tabular-nums">
              <thead className="text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th className="px-5 py-1.5 text-left font-normal">Ad</th>
                  <th className="px-3 py-1.5 text-right font-normal">Results</th>
                  <th className="px-3 py-1.5 text-right font-normal">Spend</th>
                  <th className="px-3 py-1.5 text-right font-normal">Cost per result</th>
                  <th className="px-5 py-1.5 text-right font-normal">Click-through rate</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {b.ads.map((a) => (
                  <tr key={a.key}>
                    <td className="max-w-0 px-5 py-2">
                      <span className="flex items-center gap-3">
                        <AdThumb preview={previews[a.key]} alt={a.name} size="sm" />
                        <span className="min-w-0">
                          <span className="line-clamp-2 leading-snug" title={a.name}>
                            {a.name}
                          </span>
                          <span className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                            {!b.platform && <PlatformIcon platform={a.platform} className="size-3" />}
                            {a.campaign}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{whole(a.results)}</td>
                    <td className="px-3 py-2 text-right">{money(a.spend, currency)}</td>
                    <td className="px-3 py-2 text-right">{a.results > 0 ? money(a.spend / a.results, currency) : "–"}</td>
                    <td className="px-5 py-2 text-right">{a.impressions > 0 ? percent(a.clicks / a.impressions, 2) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  )
}

/** Change against the previous period as a small tinted chip: green when better, red when worse. */
function Chip({ now, prev, better }: { now: number | null; prev: number | null; better: "up" | "down" | "none" }) {
  const pct = change(now, prev)
  if (pct === null && prev === 0 && now) return <span className="rounded bg-secondary px-1 py-px text-[11px] text-muted-foreground">New</span>
  if (pct === null) return <span className="text-muted-foreground">–</span>
  const flat = Math.abs(pct) < 0.5
  const good = better === "none" || flat ? null : (pct > 0) === (better === "up")
  const Icon = flat ? Minus : pct > 0 ? ArrowUp : ArrowDown
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded px-1 py-px text-[11px] tabular-nums", good === null ? "bg-secondary text-muted-foreground" : good ? "bg-rag-green/12 text-rag-green" : "bg-rag-red/12 text-rag-red")}>
      <Icon className="size-3" aria-hidden />
      {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%
    </span>
  )
}
