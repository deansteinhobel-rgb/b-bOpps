import { AdThumb } from "@/components/ad-thumb"
import { ClientLogo, PlatformIcon } from "@/components/brand"
import { money, percent, whole } from "@/lib/format"
import type { ReportAd } from "@/lib/metrics/client-report"
import { rangeText } from "@/lib/metrics/range"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { adKey } from "@/lib/previews"
import { cn } from "@/lib/utils"
import { Chip } from "../report-board"
import type { BreakdownRow, ClientReportData, ReportGoal } from "./data"

type Tile = { label: string; caption: string; now: number | null; prev: number | null; show: (v: number | null) => string; better: "up" | "down" | "none"; target?: number | null }

/**
 * The client report itself (Dean, 2026-10-19): written for the client, so plain words and no
 * internal notes. Headline numbers against the period before, the 3 strongest and 3 weakest ads,
 * then what happened in a few sentences. The app page and the shared link both render it.
 */
export function ClientReportView({ data: d, client, currency, note, hrefFor }: { data: ClientReportData; client: { name: string; logoUrl: string | null }; currency: string; note?: string | null; hrefFor?: (row: BreakdownRow) => string | null }) {
  const m = (v: number | null, digits = 0) => money(v, currency, digits)
  const { from, to, prevFrom, prevTo, compare } = d.periods
  const leads = d.platform !== "google_ads"
  // The overall report (Dean, 2026-10-19): four headline numbers only.
  const tiles: Tile[] = d.overall
    ? [
        { label: "Spend", caption: "Paid to the ad platforms", now: d.now.spend, prev: d.prev.spend, show: (v) => m(v), better: "none" },
        { label: "Cost per click", caption: "Spend ÷ clicks", now: d.now.cpc, prev: d.prev.cpc, show: (v) => m(v, 2), better: "down" },
        { label: "Results", caption: "Conversions on your website and leads from ad forms", now: d.now.results, prev: d.prev.results, show: whole, better: "up" },
        { label: "Cost per result", caption: "Spend ÷ results", now: d.now.cpr, prev: d.prev.cpr, show: (v) => m(v), better: "down", target: d.target },
      ]
    : [
    { label: "Spend", caption: "Paid to the ad platforms", now: d.now.spend, prev: d.prev.spend, show: (v) => m(v), better: "none" },
    { label: "Clicks", caption: "Times people clicked an ad", now: d.now.clicks, prev: d.prev.clicks, show: whole, better: "up" },
    { label: "Cost per click", caption: "Spend ÷ clicks", now: d.now.cpc, prev: d.prev.cpc, show: (v) => m(v, 2), better: "down" },
    { label: "Conversions", caption: "Actions taken on your website", now: d.now.conversions, prev: d.prev.conversions, show: whole, better: "up" },
    ...(leads ? [{ label: "Leads", caption: "Lead forms filled in on the platform", now: d.now.leads, prev: d.prev.leads, show: whole, better: "up" } as Tile] : []),
    { label: "Cost per result", caption: leads ? "Spend ÷ (conversions + leads)" : "Spend ÷ conversions", now: d.now.cpr, prev: d.prev.cpr, show: (v) => m(v), better: "down", target: d.target },
      ]

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

      {d.goals.map((g) => (
        <GoalBlock key={g.name} goal={g} />
      ))}

      {/* The headline numbers */}
      <section aria-labelledby="cr-overview">
        <h3 id="cr-overview" className="sr-only">
          Overview
        </h3>
        <dl className={cn("grid grid-cols-2 gap-px bg-border", d.overall ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
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

      {d.byPlatform.length > 0 && <Breakdown id="cr-platforms" title="By platform" rows={d.byPlatform} currency={currency} compare={compare} hrefFor={hrefFor} linkLabel="platform report" />}

      {d.adsWithSpend === 0 ? (
        <section aria-labelledby="cr-ads" className="border-t px-5 py-5 sm:px-6">
          <h3 id="cr-ads" className="text-base font-semibold">
            Ads
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">No ad-level numbers for these dates. Some campaign types, such as Performance Max, only report for the whole campaign.</p>
        </section>
      ) : (
        <>
          {/* Top ads (Dean, 2026-10-19): the overall report's top 3, or 2 for results and 2 for click-through rate side by side. */}
          {d.overall ? (
            <section aria-labelledby="cr-best" className="border-t px-5 py-5 sm:px-6">
              <h3 id="cr-best" className="text-base font-semibold">
                Top 3 performing ads
              </h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{d.picks.byResults.length ? "Across every platform: results at the lowest cost per result, among the ads that spent the most." : "Across every platform: the ads people clicked most often, among the ads that spent the most."}</p>
              <div className="mt-1">
                <AdCards ads={d.picks.byResults.length ? d.picks.byResults : d.picks.byCtr} empty="Not enough ad activity in these dates to pick the strongest ads." data={d} currency={currency} tone="good" highlight={d.picks.byResults.length ? "results" : "ctr"} wide />
              </div>
            </section>
          ) : (
          <section aria-labelledby="cr-best" className="border-t px-5 py-5 sm:px-6">
            <h3 id="cr-best" className="text-base font-semibold">
              Top performing ads
            </h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Among the ads that spent the most in these dates.</p>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <AdCards title="Best for results" caption="Results at the lowest cost per result." ads={d.picks.byResults} empty="No ads brought results in these dates." data={d} currency={currency} tone="good" highlight="results" />
              <AdCards title="Most clicked" caption="The highest share of people who saw the ad and clicked it." ads={d.picks.byCtr} empty="No other ads drew clicks in these dates." data={d} currency={currency} tone="good" highlight="ctr" />
            </div>
          </section>
          )}
          <section aria-labelledby="cr-worst" className="border-t px-5 py-5 sm:px-6">
            <h3 id="cr-worst" className="text-base font-semibold">
              {d.overall ? "3 ads to improve" : "Ads to improve"}
            </h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{d.picks.worstBasis === "ctr" ? "The ads people clicked least often, among the ads that spent the most." : "The ads with the highest cost per result (or none yet), among the ads that spent the most."}</p>
            <div className="mt-4">
              <AdCards ads={d.picks.worst} empty="Too few ads ran in these dates to single out weaker ones." data={d} currency={currency} tone="bad" highlight={d.picks.worstBasis === "ctr" ? "ctr" : "results"} wide />
            </div>
          </section>
        </>
      )}

      {d.byCampaign.length > 0 && <Breakdown id="cr-campaigns" title="By campaign" rows={d.byCampaign} currency={currency} compare={compare} hrefFor={hrefFor} linkLabel="campaign report" showPlatform={!d.platform} />}

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

function AdCards({ title, caption, ads, empty, data: d, currency, tone, highlight, wide }: { title?: string; caption?: string; ads: ReportAd[]; empty: string; data: ClientReportData; currency: string; tone: "good" | "bad"; highlight: "results" | "ctr"; wide?: boolean }) {
  const m = (v: number | null) => money(v, currency, v !== null && v < 100 ? 2 : 0)
  const ctrBasis = highlight === "ctr"
  return (
    <div>
      {title && <h4 className="text-sm font-semibold">{title}</h4>}
      {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
      {ads.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className={cn("mt-3 grid gap-4 sm:grid-cols-2", wide && "lg:grid-cols-3")}>
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
    </div>
  )
}

/** The client's business goal, month by month (Dean, 2026-10-19: DNSFilter's activated free trials first). */
function GoalBlock({ goal }: { goal: ReportGoal }) {
  const months = goal.months.slice(0, 3)
  return (
    <section aria-labelledby="cr-goal" className="border-b px-5 py-5 sm:px-6">
      <h3 id="cr-goal" className="text-base font-semibold">
        {goal.name}
      </h3>
      <ul className={cn("mt-3 grid gap-3", months.length > 1 && "sm:grid-cols-2", months.length > 2 && "lg:grid-cols-3")}>
        {months.map((x) => {
          const met = x.value !== null && x.target !== null && x.value >= x.target
          const pace = x.inProgress && x.value !== null && x.expected !== null ? x.value - x.expected : null
          const share = x.value !== null && x.target ? x.value / x.target : null
          const note =
            x.value === null
              ? "Not recorded yet."
              : met
                ? `Target reached (${Math.round(share! * 100)}%).`
                : pace !== null
                  ? pace >= 0
                    ? `On pace: ${whole(pace)} ahead of where the target needs it today.`
                    : `${whole(-pace)} behind the pace the target needs today.`
                  : share !== null
                    ? `${Math.round(share * 100)}% of the target.`
                    : ""
          return (
            <li key={x.month} className="rounded-xl border bg-background/40 p-4">
              <p className="text-[13px] text-muted-foreground">
                {x.label}
                {x.inProgress ? " so far" : ""}
              </p>
              <p className="mt-1.5 flex items-baseline gap-2">
                <span className="font-heading text-4xl leading-none tabular-nums">{x.value === null ? "–" : whole(x.value)}</span>
                {x.target !== null && <span className="text-sm text-muted-foreground tabular-nums">of {whole(x.target)} target</span>}
              </p>
              {share !== null && (
                <span className="relative mt-3 block h-2 rounded-full bg-secondary" aria-hidden>
                  <span className={cn("block h-full rounded-full", met ? "bg-rag-green" : x.inProgress ? "bg-lime" : "bg-rag-amber")} style={{ width: `${(Math.min(share, 1) * 100).toFixed(1)}%` }} />
                  {x.expected !== null && x.target ? <span className="absolute -top-1 h-4 w-0.5 rounded bg-foreground" style={{ left: `${Math.min((x.expected / x.target) * 100, 100)}%` }} /> : null}
                </span>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{note}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** One row per platform or campaign, each opening its own report (Dean, 2026-10-19). Ten rows, then the rest folded. */
function Breakdown({ id, title, rows, currency, compare, hrefFor, linkLabel, showPlatform = true }: { id: string; title: string; rows: BreakdownRow[]; currency: string; compare: boolean; hrefFor?: (row: BreakdownRow) => string | null; linkLabel: string; showPlatform?: boolean }) {
  const m = (v: number | null, digits = 0) => money(v, currency, digits)
  const row = (r: BreakdownRow) => {
    const href = hrefFor?.(r) ?? null
    return (
      <tr key={r.value} className={cn(href && "group hover:bg-white/[0.03]")}>
        <td className="max-w-0 px-5 py-2.5 sm:pl-6">
          <span className="flex min-w-0 items-center gap-2">
            {showPlatform && <PlatformIcon platform={r.platform} className="size-4 shrink-0" />}
            {href ? (
              <a href={href} className="truncate underline-offset-4 group-hover:underline" title={`${r.name}: open the ${linkLabel}`}>
                {r.name}
              </a>
            ) : (
              <span className="truncate" title={r.name}>
                {r.name}
              </span>
            )}
          </span>
        </td>
        <td className="w-24 px-3 py-2.5 text-right">{m(r.now.spend)}</td>
        <td className="hidden w-20 px-3 py-2.5 text-right sm:table-cell">{whole(r.now.clicks)}</td>
        <td className="hidden w-24 px-3 py-2.5 text-right sm:table-cell">{r.now.cpc === null ? "–" : m(r.now.cpc, 2)}</td>
        <td className="w-20 px-3 py-2.5 text-right">{whole(r.now.results)}</td>
        <td className="w-40 px-5 py-2.5 text-right sm:pr-6">
          <span className="inline-flex items-center gap-1.5">
            {r.now.cpr === null ? "–" : m(r.now.cpr)}
            {compare && <Chip now={r.now.cpr} prev={r.prev.cpr} better="down" />}
          </span>
        </td>
      </tr>
    )
  }
  return (
    <section aria-labelledby={id} className="border-t py-5">
      <div className="px-5 sm:px-6">
        <h3 id={id} className="text-base font-semibold">
          {title}
        </h3>
        {hrefFor && <p className="mt-0.5 text-[13px] text-muted-foreground">Open one to see its own report.</p>}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[30rem] table-fixed text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-5 py-2 text-left font-normal sm:pl-6">{title === "By platform" ? "Platform" : "Campaign"}</th>
              <th className="w-24 px-3 py-2 text-right font-normal">Spend</th>
              <th className="hidden w-20 px-3 py-2 text-right font-normal sm:table-cell">Clicks</th>
              <th className="hidden w-24 px-3 py-2 text-right font-normal sm:table-cell">Cost per click</th>
              <th className="w-20 px-3 py-2 text-right font-normal">Results</th>
              <th className="w-40 px-5 py-2 text-right font-normal sm:pr-6">Cost per result</th>
            </tr>
          </thead>
          <tbody className="divide-y">{rows.slice(0, 10).map(row)}</tbody>
        </table>
        {rows.length > 10 && (
          <details className="group/more">
            <summary className="cursor-pointer list-none px-5 py-2.5 text-[13px] text-muted-foreground hover:text-foreground sm:px-6">
              <span className="group-open/more:hidden">Show {rows.length - 10} more</span>
              <span className="hidden group-open/more:inline">Show fewer</span>
            </summary>
            <table className="w-full min-w-[30rem] table-fixed text-sm tabular-nums">
              <tbody className="divide-y border-t">{rows.slice(10).map(row)}</tbody>
            </table>
          </details>
        )}
      </div>
    </section>
  )
}
