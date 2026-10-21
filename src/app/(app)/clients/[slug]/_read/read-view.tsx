"use client"

// The read (Dean, 2026-10-21, after ZenABM's reports): the Summary (this month so far) and the weekly read.
// The order is the point: the verdict, then what's working / needs attention / where to act, then the
// numbers, then the evidence (top 5 of each list, "Show all" for the rest). Every ad that's named shows
// its preview.
import { useState } from "react"
import Link from "next/link"
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Download, Lock } from "lucide-react"
import { AdThumb } from "@/components/ad-thumb"
import { ClientLogo, PlatformIcon, PlatformLabel } from "@/components/brand"
import { Hint } from "@/components/hint"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { money as fmtMoney, whole } from "@/lib/format"
import type { AbxRead, AccountRow, AdRow, Flag as FlagRow, ReadAd, ReadCore, ReadItem, Tile, Tone, WeeklyRead } from "@/lib/reports/weekly-read-rules"
import { cn } from "@/lib/utils"

type View = "overall" | "abx"

const TONE_TEXT: Record<Tone, string> = { good: "text-rag-green", bad: "text-rag-red", neutral: "text-muted-foreground" }
/** Long names (Google search ads are named after all their headlines) cut short; the full name shows on hover. */
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(2)}%`)
const monthOf = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })
const day = (iso: string, withYear = false) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" })

/** A CSV download of a table (the Export buttons). */
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v))
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${name}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * `nav`: the week arrows (weekly read only). `goals`: the client's goal cards, under the verdict.
 * `below`: anything after the flags (the Summary's What's changed and What's planned cards).
 */
export function ReadView({ read, initialAbx, nav, goals, below }: { read: WeeklyRead; initialAbx: boolean; nav?: { prev: string; next: string | null; isLatest: boolean } | null; goals?: React.ReactNode; below?: React.ReactNode }) {
  const [view, setViewState] = useState<View>(initialAbx && read.abx ? "abx" : "overall")
  const m = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "–" : fmtMoney(v, read.client.currency, digits))
  // The view lives in the URL (?abx=1, shareable) without a server round trip. Not ?view=: the goal
  // cards' side panels use that.
  const setView = (v: View) => {
    setViewState(v)
    const url = new URL(window.location.href)
    if (v === "abx") url.searchParams.set("abx", "1")
    else url.searchParams.delete("abx")
    window.history.replaceState(window.history.state, "", url)
  }
  const core: ReadCore = view === "abx" && read.abx ? read.abx : read.overall
  const weekHref = (w: string) => `?week=${w}${view === "abx" ? "&abx=1" : ""}`
  const slug = read.client.slug
  const p = read.week
  const current = p.kind === "month" ? "this month" : "last week"

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {nav && (
            <Link href={weekHref(nav.prev)} aria-label="The week before" className="inline-flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-border-strong hover:text-foreground">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          )}
          <span className="text-sm font-medium">{p.kind === "month" ? `${monthOf(p.from)} so far` : nav?.isLatest ? "Last week" : "Week of"}</span>
          <span className="text-sm text-body tabular-nums">
            {day(p.from)} – {day(p.to, true)}
          </span>
          <span className="text-[13px] text-muted-foreground">
            against {day(p.prevFrom)} – {day(p.prevTo)}
          </span>
          {nav?.next ? (
            <Link href={weekHref(nav.next)} aria-label="The week after" className="inline-flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-border-strong hover:text-foreground">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null}
          {!read.complete && <span className="pill text-rag-amber">Data to {day(read.dataThrough)} so far</span>}
        </div>
        {read.abx && <ViewSwitch value={view} onChange={setView} abxLabel={read.abx.segmentLabel} />}
      </div>

      {/* The verdict answers the page's question; the client's goal sits beside it, then the numbers
          behind it, then what to do. A lone goal never sits in a row of its own (taste skill). */}
      {goals ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Verdict core={core} />
          {goals}
        </div>
      ) : (
        <Verdict core={core} />
      )}
      <Tiles tiles={core.tiles} />
      <ThreeColumns core={core} />

      {view === "abx" && read.abx ? <AbxEvidence abx={read.abx} m={m} slug={slug} current={current} /> : <OverallEvidence read={read} m={m} current={current} />}

      <Flags green={core.green} red={core.red} />

      {view === "abx" && <CrmTeaser />}

      {below}

      <p className="pt-2 text-center text-[13px] text-muted-foreground">
        Something missing or wrong in this read?{" "}
        <Link href="/options?tab=feature" className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
          Tell us
        </Link>
      </p>
    </div>
  )
}

function ViewSwitch({ value, onChange, abxLabel }: { value: View; onChange: (v: View) => void; abxLabel: string }) {
  const opts: { v: View; label: string; hint: string }[] = [
    { v: "overall", label: "Overall", hint: "Every platform, judged on results and cost per result" },
    { v: "abx", label: abxLabel, hint: "The account-based campaigns, and the companies they reached on LinkedIn" },
  ]
  return <Segmented label="View" value={value} onChange={onChange} options={opts.map((o) => ({ value: o.v, label: o.label, title: o.hint }))} />
}

/** The period in one sentence, the numbers behind it, and an 8-week trend (the current period in lime). */
function Verdict({ core }: { core: ReadCore }) {
  const { verdict } = core
  const max = Math.max(...verdict.trend, 1)
  const last = verdict.trend.at(-1)
  return (
    <section className="surface h-full p-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-3xl">
          {/* The good or bad sits in the words; a small dot repeats it for a quick scan. */}
          <h2 className="text-2xl leading-snug sm:text-[28px] sm:leading-9">
            <span aria-hidden className={cn("mr-3 inline-block size-2.5 -translate-y-1 rounded-full align-middle", verdict.tone === "bad" ? "bg-rag-red" : verdict.tone === "good" ? "bg-rag-green" : "bg-rag-na")} />
            {verdict.headline}
          </h2>
          {verdict.body && <p className="mt-3 text-sm leading-relaxed text-body">{verdict.body}</p>}
        </div>
        {verdict.trend.length > 1 && (
          <figure className="shrink-0 self-start md:self-auto" aria-label={verdict.trendLabel}>
            <div className="mb-1 text-right text-xs text-foreground tabular-nums">{last !== undefined ? whole(last) : ""}</div>
            <div className="flex h-16 items-end gap-1 border-b border-border-strong">
              {verdict.trend.map((v, i) => (
                <div key={i} title={whole(v)} className={cn("w-3.5", i === verdict.trend.length - 1 ? "bg-lime" : "bg-white/20")} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
              ))}
            </div>
            <figcaption className="mt-2 text-xs text-muted-foreground">{verdict.trendLabel}</figcaption>
          </figure>
        )}
      </div>
    </section>
  )
}

const COLUMNS = [
  { key: "working", title: "What's working", dot: "bg-rag-green", empty: "Nothing stood out this week." },
  { key: "attention", title: "What needs attention", dot: "bg-rag-amber", empty: "Nothing needs attention. Good week." },
  { key: "act", title: "Where to act", dot: "bg-foreground", empty: "No open recommendations." },
] as const

/** One box split into three columns (group, don't box), so the three lists share a top and a bottom. */
function ThreeColumns({ core }: { core: ReadCore }) {
  return (
    <section className="surface grid divide-y divide-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      {COLUMNS.map((c) => (
        <div key={c.key} className="min-w-0 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden className={cn("size-2 rounded-full", c.dot)} />
            {c.title}
            <span className="font-normal text-muted-foreground tabular-nums">{core[c.key].length}</span>
          </h3>
          {core[c.key].length ? (
            <ul className="mt-4 space-y-5">
              {core[c.key].map((item) => (
                <ReadLine key={item.key} item={item} />
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-[13px] text-muted-foreground">{c.empty}</p>
          )}
        </div>
      ))}
    </section>
  )
}

function ReadLine({ item }: { item: ReadItem }) {
  const one = item.ads?.length === 1 ? item.ads[0] : null
  const title = item.href ? (
    <Link href={item.href} title={item.title} className="text-sm font-medium text-foreground underline decoration-border-strong decoration-dotted underline-offset-4 hover:decoration-foreground">
      {short(item.title)}
    </Link>
  ) : (
    <span className="text-sm font-medium" title={item.title}>
      {short(item.title)}
    </span>
  )
  return (
    <li className="flex gap-3">
      {/* One named ad: the ad itself leads the line. Otherwise the text starts on the column's edge. */}
      {one && (
        <span className="relative mt-0.5 shrink-0">
          <AdThumb preview={one.preview ?? undefined} alt={one.name} size="sm" className="size-12" />
          {item.platform && <PlatformIcon platform={item.platform} className="absolute -right-1 -bottom-1 size-3.5" />}
        </span>
      )}
      <div className="min-w-0">
        <div className="break-words">
          {!one && item.platform && <PlatformIcon platform={item.platform} className="-mt-0.5 mr-1.5 size-3.5 align-middle" />}
          {title}
        </div>
        {item.tag && <div className="mt-0.5 text-xs font-medium text-body">{item.tag}</div>}
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{item.detail}</p>
        {item.ads && item.ads.length > 1 && (
          <div className="mt-2 flex gap-1.5">
            {item.ads.map((a) => (
              <AdThumb key={a.key} preview={a.preview ?? undefined} alt={a.name} size="sm" className="size-11" />
            ))}
          </div>
        )}
        {item.action && (
          <Link href={item.action.href} className="group/act mt-2 inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {item.action.label}
            <ArrowRight className="size-3.5 transition-transform group-hover/act:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </div>
    </li>
  )
}

/** The numbers behind the verdict: one box split by hairlines, label over value, the change against
 *  the comparison period under it. No sparklines (the trend is the verdict's chart). */
function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <section className="surface overflow-hidden">
      {/* Each cell draws its left and top hairline; the grid sits 1px up and left so the outer ones are clipped. */}
      <div className={cn("-mt-px -ml-px grid grid-cols-2 sm:grid-cols-3", tiles.length >= 6 ? "lg:grid-cols-6" : "lg:grid-cols-5")}>
      {tiles.map((t) => (
        <div key={t.label} className="p-4 shadow-[inset_1px_1px_0_var(--border)]">{/* taste-skill-ignore: hairlines between cells */}
          <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
            {t.label}
            {t.hint && <Hint>{t.hint}</Hint>}
          </div>
          <div className="mt-1.5 text-2xl font-medium tabular-nums">{t.now}</div>
          <div className="mt-1 flex min-h-4 items-baseline gap-1.5 text-xs">
            {t.change && <span className={cn("font-medium tabular-nums", TONE_TEXT[t.tone])}>{t.change}</span>}
            {t.before !== null && <span className="text-muted-foreground">vs {t.before}</span>}
          </div>
        </div>
      ))}
      </div>
    </section>
  )
}

/** A titled card holding a table or list: Export, and the top 5 until "Show all". */
function Panel({ id, title, meta, total, expanded, onToggle, onExport, children }: { id?: string; title: string; meta?: React.ReactNode; total?: number; expanded?: boolean; onToggle?: () => void; onExport?: () => void; children: React.ReactNode }) {
  return (
    <section id={id} className="surface scroll-mt-24 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{title}</h3>
          {meta && <p className="mt-0.5 text-[13px] text-muted-foreground">{meta}</p>}
        </div>
        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download aria-hidden /> Export
          </Button>
        )}
      </div>
      <div className="mt-4">{children}</div>
      {total !== undefined && total > 5 && onToggle && (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>
            Showing {expanded ? total : 5} of {total}
          </span>
          <button onClick={onToggle} className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
            {expanded ? "Show top 5" : "Show all"}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
        </div>
      )}
    </section>
  )
}

const TH = "px-3 py-2 text-left text-xs font-medium text-muted-foreground first:pl-5 last:pr-5"
const TD = "px-3 py-2.5 tabular-nums first:pl-5 last:pr-5"
type Money = (v: number | null | undefined, digits?: number) => string

function OverallEvidence({ read, m, current }: { read: WeeklyRead; m: Money; current: string }) {
  const { overall } = read
  return (
    <div className="space-y-4">
      <Panel
        title="By platform"
        meta={`${current.charAt(0).toUpperCase()}${current.slice(1)}, with the month's budget pacing`}
        onExport={() => downloadCsv(`${read.client.slug}-platforms-${read.week.from}`, [["Platform", "Spend", "Results", "Cost per result", "Target", "Month spend", "Month budget"], ...overall.platforms.map((p) => [p.platform, p.spend.toFixed(2), p.results, p.cpr?.toFixed(2) ?? null, p.target, p.month?.spend.toFixed(2) ?? null, p.month?.budget ?? null])])}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={TH}>Platform</th>
                <th className={cn(TH, "text-right")}>Spend</th>
                <th className={cn(TH, "text-right")}>Results</th>
                <th className={cn(TH, "text-right")}>Cost per result</th>
                <th className={cn(TH, "w-44")}>Month so far</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {overall.platforms.map((r) => {
                const budget = r.month?.budget ?? null
                const ahead = r.month && r.month.expected ? r.month.spend / r.month.expected - 1 : null
                return (
                  <tr key={r.platform}>
                    <td className={TD}>
                      <PlatformLabel platform={r.platform} />
                    </td>
                    <td className={cn(TD, "text-right")}>{m(r.spend)}</td>
                    <td className={cn(TD, "text-right")}>{whole(r.results)}</td>
                    <td className={cn(TD, "text-right whitespace-nowrap")}>
                      <span className={r.cpr === null || r.target === null ? "" : r.cpr <= r.target ? "text-rag-green" : r.cpr > r.target * 1.2 ? "text-rag-red" : "text-rag-amber"}>{m(r.cpr)}</span>
                      {r.target !== null && <span className="ml-1.5 text-xs text-muted-foreground">/ {m(r.target)}</span>}
                    </td>
                    <td className={TD}>
                      {r.month && budget ? (
                        <>
                          <div className="relative h-1.5 rounded-full bg-white/10">
                            <div className={cn("h-full rounded-full", ahead === null || Math.abs(ahead) <= 0.1 ? "bg-rag-green" : ahead > 0.2 ? "bg-rag-red" : "bg-rag-amber")} style={{ width: `${Math.min(100, (r.month.spend / budget) * 100)}%` }} />
                            <div className="absolute -top-1 h-3.5 w-px bg-white" style={{ left: `${Math.min(100, (r.month.expected / budget) * 100)}%` }} title="Where spend should be today" />
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {m(r.month.spend)} of {m(budget)}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">No budget set</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <AdsPanel title="Top ads" meta={`Each platform's best ${current}: results first, then cost per result`} rows={overall.ads} m={m} name={`${read.client.slug}-top-ads-${read.week.from}`} />
    </div>
  )
}

function AdsPanel({ title, meta, rows, m, name }: { title: string; meta: string; rows: AdRow[]; m: Money; name: string }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, 5)
  return (
    <Panel title={title} meta={meta} total={rows.length} expanded={all} onToggle={() => setAll((v) => !v)} onExport={() => downloadCsv(name, [["Ad", "Platform", "Format", "Campaign", "Results", "Cost per result", "CTR", "Spend"], ...rows.map((a) => [a.ad.name, a.ad.platform, a.format, a.campaign, a.results, a.cpr?.toFixed(2) ?? null, a.ctr === null ? null : (a.ctr * 100).toFixed(2), a.spend.toFixed(2)])])}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className={TH}>Ad</th>
              <th className={cn(TH, "text-right")}>Results</th>
              <th className={cn(TH, "text-right")}>Cost per result</th>
              <th className={cn(TH, "text-right")}>CTR</th>
              <th className={cn(TH, "text-right")}>Spend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((a) => (
              <tr key={a.ad.key}>
                <td className={cn(TD, "max-w-md")}>
                  <AdCell ad={a.ad} format={a.format} campaign={a.campaign} />
                </td>
                <td className={cn(TD, "text-right")}>{whole(a.results)}</td>
                <td className={cn(TD, "text-right")}>{m(a.cpr)}</td>
                <td className={cn(TD, "text-right")}>{pct(a.ctr)}</td>
                <td className={cn(TD, "text-right")}>{m(a.spend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/** An ad in a table: its preview, then the name with the platform, format and campaign under it. */
function AdCell({ ad, format, campaign }: { ad: ReadAd; format: string; campaign: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AdThumb preview={ad.preview ?? undefined} alt={ad.name} size="sm" className="size-12" />
      <div className="min-w-0">
        <div className="truncate font-medium" title={ad.name}>
          {ad.name}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <PlatformIcon platform={ad.platform} className="size-3.5" />
          <span className="shrink-0">{format}</span>
          {campaign && <span className="truncate">· {campaign}</span>}
        </div>
      </div>
    </div>
  )
}

function AbxEvidence({ abx, m, slug, current }: { abx: AbxRead; m: Money; slug: string; current: string }) {
  const [allPrio, setAllPrio] = useState(false)
  const [allWatch, setAllWatch] = useState(false)
  const through = abx.accountsThrough ? `LinkedIn's last 30 days to ${day(abx.accountsThrough)}, refreshed about weekly` : "No LinkedIn company data yet"
  const accountCsv = (name: string, rows: AccountRow[]) => downloadCsv(name, [["Company", "Impressions", "Clicks", "CTR", "Spend", "Campaigns", "ICP (Claude)", "Why"], ...rows.map((a) => [a.name, a.impressions, a.clicks, a.ctr === null ? null : (a.ctr * 100).toFixed(2), a.spend.toFixed(2), a.campaigns, a.fit, a.reason ?? a.fitReason])])
  return (
    <div className="space-y-4">
      {abx.formats.length > 0 && (
        <Panel title="Ad formats" meta={`${abx.segmentLabel} campaigns, ${current}`} onExport={() => downloadCsv(`${slug}-abx-formats`, [["Format", "Ads", "CTR", "Impressions", "Clicks", "Results", "Spend"], ...abx.formats.map((f) => [f.format, f.count, f.impressions ? ((f.clicks / f.impressions) * 100).toFixed(2) : null, f.impressions, f.clicks, f.results, f.spend.toFixed(2)])])}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className={TH}>Format</th>
                  <th className={cn(TH, "text-right")}>CTR</th>
                  <th className={cn(TH, "text-right")}>Impressions</th>
                  <th className={cn(TH, "text-right")}>Clicks</th>
                  <th className={cn(TH, "text-right")}>Results</th>
                  <th className={cn(TH, "text-right")}>Spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {abx.formats.map((f) => (
                  <tr key={f.format}>
                    <td className={TD}>
                      <div className="flex items-center gap-3">
                        <span className="pill w-28 justify-center text-xs">
                          {f.format} · {f.count}
                        </span>
                        <div className="flex gap-1">
                          {f.ads.map((a) => (
                            <AdThumb key={a.key} preview={a.preview ?? undefined} alt={a.name} size="sm" className="size-8" />
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className={cn(TD, "text-right")}>{f.impressions ? pct(f.clicks / f.impressions) : "–"}</td>
                    <td className={cn(TD, "text-right")}>{whole(f.impressions)}</td>
                    <td className={cn(TD, "text-right")}>{whole(f.clicks)}</td>
                    <td className={cn(TD, "text-right")}>{whole(f.results)}</td>
                    <td className={cn(TD, "text-right")}>{m(f.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <AdsPanel title="Top ads" meta={`${abx.segmentLabel} campaigns: the best by results, then by CTR`} rows={abx.ads} m={m} name={`${slug}-abx-top-ads`} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel id="accounts" title="Accounts to prioritize" meta={`Clicking most (100+ impressions, 2+ clicks), not judged outside the ICP. ${through}.`} total={abx.prioritize.length} expanded={allPrio} onToggle={() => setAllPrio((v) => !v)} onExport={() => accountCsv(`${slug}-accounts-to-prioritize`, abx.prioritize)}>
          {abx.prioritize.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {(allPrio ? abx.prioritize : abx.prioritize.slice(0, 5)).map((a) => (
                <AccountLine key={a.name} a={a} m={m} right={<span className="text-[13px] tabular-nums text-muted-foreground"><span className="font-medium text-rag-green">{pct(a.ctr)}</span> on {whole(a.impressions)}</span>} />
              ))}
            </ul>
          ) : (
            <p className="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">No accounts with enough clicks yet.</p>
          )}
        </Panel>
        <Panel id="watch" title="Accounts to watch" meta="Outside the ICP, taking spend without clicks, or gone quiet. Exclude them in LinkedIn." total={abx.watch.length} expanded={allWatch} onToggle={() => setAllWatch((v) => !v)} onExport={() => accountCsv(`${slug}-accounts-to-watch`, abx.watch)}>
          {abx.watch.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {(allWatch ? abx.watch : abx.watch.slice(0, 5)).map((a) => (
                <AccountLine key={a.name} a={a} m={m} sub={a.reason} right={<span className="text-[13px] tabular-nums text-muted-foreground">{m(a.spend)}</span>} />
              ))}
            </ul>
          ) : (
            <p className="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">Nothing to watch. Every account taking spend is clicking.</p>
          )}
        </Panel>
      </div>

      {abx.titles.length > 0 && (
        <Panel title="Job titles taking spend" meta={`${abx.segmentLabel} campaigns, ${through.charAt(0).toLowerCase()}${through.slice(1)}.`} onExport={() => downloadCsv(`${slug}-abx-job-titles`, [["Job title", "Spend", "Impressions", "Clicks", "CTR"], ...abx.titles.map((t) => [t.title, t.spend.toFixed(2), t.impressions, t.clicks, t.ctr === null ? null : (t.ctr * 100).toFixed(2)])])}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className={TH}>Job title</th>
                  <th className={cn(TH, "text-right")}>Spend</th>
                  <th className={cn(TH, "text-right")}>Impressions</th>
                  <th className={cn(TH, "text-right")}>Clicks</th>
                  <th className={cn(TH, "text-right")}>CTR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {abx.titles.map((t) => (
                  <tr key={t.title}>
                    <td className={TD}>{t.title}</td>
                    <td className={cn(TD, "text-right")}>{m(t.spend)}</td>
                    <td className={cn(TD, "text-right")}>{whole(t.impressions)}</td>
                    <td className={cn(TD, "text-right")}>{whole(t.clicks)}</td>
                    <td className={cn(TD, "text-right")}>{pct(t.ctr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}

const FIT = { icp: { label: "ICP", cls: "text-rag-green" }, not_icp: { label: "Not ICP", cls: "text-rag-red" }, unsure: { label: "Unsure", cls: "text-muted-foreground" } } as const

function AccountLine({ a, sub, right, m }: { a: AccountRow; sub?: string; right: React.ReactNode; m: Money }) {
  const max = Math.max(...a.trend, 1)
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <ClientLogo name={a.name} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{a.name}</span>
          {a.fit && (
            <span className={cn("shrink-0 text-xs", FIT[a.fit].cls)} title={a.fitReason ?? "Claude's daily review"}>
              {FIT[a.fit].label}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{sub ?? `${whole(a.clicks)} clicks · ${m(a.spend)} · ${a.campaigns} campaign${a.campaigns === 1 ? "" : "s"}`}</div>
      </div>
      {a.trend.length > 1 && (
        <div className="hidden h-5 items-end gap-0.5 sm:flex" aria-hidden title="Clicks in each LinkedIn snapshot, oldest first">
          {a.trend.map((v, i) => (
            <span key={i} className="w-1 rounded-sm bg-white/25" style={{ height: `${Math.max(10, (v / max) * 100)}%` }} />
          ))}
        </div>
      )}
      <div className="shrink-0">{right}</div>
    </li>
  )
}

/** Green and red flags: one line each, the kind first so the list scans. */
function Flags({ green, red }: { green: FlagRow[]; red: FlagRow[] }) {
  if (!green.length && !red.length) return null
  return (
    <section className="surface grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
      {[
        { title: "Green flags", rows: green, dot: "bg-rag-green", empty: "None this week." },
        { title: "Red flags", rows: red, dot: "bg-rag-red", empty: "None this week." },
      ].map((f) => (
        <div key={f.title} className="min-w-0 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden className={cn("size-2 rounded-full", f.dot)} /> {f.title}
            <span className="font-normal text-muted-foreground tabular-nums">{f.rows.length}</span>
          </h3>
          {f.rows.length ? (
            <ul className="mt-3 space-y-2.5">
              {f.rows.map((r) => (
                <li key={r.key} className={cn("flex gap-2.5 text-sm leading-snug", r.ad && "items-center")}>
                  {r.ad && <AdThumb preview={r.ad.preview ?? undefined} alt={r.ad.name} size="sm" className="size-9" />}
                  <span className="min-w-0 break-words">
                    <span className="text-muted-foreground">{r.kind}: </span>
                    {r.platform && <PlatformIcon platform={r.platform} className="-mt-0.5 mr-1 size-3.5" />}
                    {r.href ? (
                      <Link href={r.href} title={r.subject} className="font-medium underline decoration-border-strong decoration-dotted underline-offset-4 hover:decoration-foreground">
                        {short(r.subject)}
                      </Link>
                    ) : (
                      <span className="font-medium" title={r.subject}>
                        {short(r.subject)}
                      </span>
                    )}
                    <span className="text-muted-foreground">. {r.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">{f.empty}</p>
          )}
        </div>
      ))}
    </section>
  )
}

/** What the ABX view gains once a CRM is connected: a promise, never empty $0 tiles. */
function CrmTeaser() {
  const items = [
    { title: "Stage movement", detail: "Accounts moving up or back a stage, and clicks with no stage change in 60 days" },
    { title: "Big spend, no deal", detail: "Ad spend per account against open opportunities" },
    { title: "Pipeline per $", detail: "Pipeline created and closed won against ad spend, this quarter against last" },
  ]
  return (
    <section className="rounded-[var(--radius)] border border-dashed border-border-strong p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Lock className="size-4 text-muted-foreground" aria-hidden /> With a CRM connected
      </h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.title}>
            <div className="text-sm font-medium text-body">{i.title}</div>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{i.detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
