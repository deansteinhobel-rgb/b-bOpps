"use client"

import { useMemo, useState } from "react"
import { fmt, type Derived } from "@/lib/metrics/performance"
import type { BreakdownRow, CampaignBreakdowns, ImpressionShareDay, LandingPage, LinkedInKind } from "@/lib/metrics/breakdowns"
import { cn } from "@/lib/utils"

/** Impression share parts (validated for the dark surface; always labelled in the legend and tooltip). */
const IS_COLOR = { won: "#4f8fcf", rank: "#c7802f", budget: "#9a6fd0" }
const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(d)}%`)
const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso))

type Col<T> = { key: string; label: string; align?: "right"; value: (r: T) => number | string | null; render?: (r: T) => React.ReactNode; className?: string }

/** A sortable, searchable table that shows the first 25 rows and can show the rest. */
function DataTable<T>({ rows, cols, search, empty, initial, rowKey }: { rows: T[]; cols: Col<T>[]; search?: (r: T) => string; empty: string; initial: string; rowKey: (r: T) => string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initial, dir: -1 })
  const [q, setQ] = useState("")
  const [all, setAll] = useState(false)
  const shown = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) ?? cols[0]
    const needle = q.trim().toLowerCase()
    return rows
      .filter((r) => !needle || !search || search(r).toLowerCase().includes(needle))
      .sort((a, b) => {
        const x = col.value(a)
        const y = col.value(b)
        if (typeof x === "string" || typeof y === "string") return String(x ?? "").localeCompare(String(y ?? "")) * sort.dir
        return ((x ?? -Infinity) - (y ?? -Infinity)) * sort.dir
      })
  }, [rows, cols, sort, q, search])
  const list = all ? shown : shown.slice(0, 25)
  return (
    <div>
      {search && (
        <div className="border-b px-4 py-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search" className="h-8 w-56 rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30" />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              {cols.map((c) => (
                <th key={c.key} className={cn("px-3 py-2 font-normal first:pl-4 last:pr-4", c.align === "right" ? "text-right" : "text-left")}>
                  <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cn("hover:text-foreground", sort.key === c.key && "text-foreground")}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-accent/30">
                {cols.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2 first:pl-4 last:pr-4", c.align === "right" && "text-right", c.className)}>
                    {c.render ? c.render(r) : (c.value(r) ?? "–")}
                  </td>
                ))}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="px-4 py-8 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > 25 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="w-full border-t px-4 py-2 text-xs text-muted-foreground hover:bg-accent/30 hover:text-foreground">
          {all ? "Show fewer" : `Show all ${shown.length}`}
        </button>
      )}
    </div>
  )
}

const metricCols = (currency: string, results = true): Col<{ m: Derived }>[] => [
  { key: "spend", label: "Spend", align: "right", value: (r) => r.m.spend, render: (r) => fmt("spend", r.m.spend, currency) },
  { key: "impressions", label: "Impr.", align: "right", value: (r) => r.m.impressions, render: (r) => fmt("impressions", r.m.impressions, currency) },
  { key: "clicks", label: "Clicks", align: "right", value: (r) => r.m.clicks, render: (r) => fmt("clicks", r.m.clicks, currency) },
  { key: "ctr", label: "CTR", align: "right", value: (r) => r.m.ctr, render: (r) => fmt("ctr", r.m.ctr, currency) },
  ...(results
    ? ([
        { key: "results", label: "Results", align: "right", value: (r) => r.m.results, render: (r) => fmt("results", r.m.results, currency) },
        { key: "cpr", label: "Cost / result", align: "right", value: (r) => r.m.cpr, render: (r) => fmt("cpr", r.m.cpr, currency) },
      ] as Col<{ m: Derived }>[])
    : []),
]

function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} type="button" onClick={() => onChange(t.key)} className={cn("rounded-md px-3 py-1.5 text-sm", value === t.key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-muted-foreground">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Daily impression share as 100% bars: won, lost to rank, lost to budget. */
function ImpressionShare({ days }: { days: ImpressionShareDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const valid = days.filter((d) => d.share !== null)
  if (!valid.length) return <p className="px-5 py-6 text-sm text-muted-foreground">No impression share data for this campaign (display and some campaign types don&apos;t report it).</p>
  const avg = (k: keyof ImpressionShareDay) => {
    const v = valid.map((d) => d[k] as number | null).filter((x): x is number => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const h = hover === null ? null : valid[hover]
  return (
    <div className="space-y-4 p-5">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {(
          [
            ["Impression share", avg("share"), IS_COLOR.won],
            ["Lost to rank", avg("lostRank"), IS_COLOR.rank],
            ["Lost to budget", avg("lostBudget"), IS_COLOR.budget],
            ["Top of page", avg("top"), null],
            ["Absolute top", avg("absTop"), null],
          ] as const
        ).map(([label, v, color]) => (
          <div key={label}>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {color && <span className="size-2 rounded-sm" style={{ background: color }} />}
              {label}
            </dt>
            <dd className="mt-1 font-heading text-2xl tabular-nums">{pct(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="relative">
        <div className="flex h-28 items-end gap-0.5" onMouseLeave={() => setHover(null)} role="img" aria-label="Daily impression share: won, lost to rank and lost to budget">
          {valid.map((d, i) => {
            const won = d.share ?? 0
            const rank = d.lostRank ?? 0
            const budget = d.lostBudget ?? 0
            return (
              <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col-reverse gap-px" onMouseEnter={() => setHover(i)}>
                <div className="rounded-b-sm" style={{ height: `${won * 100}%`, background: IS_COLOR.won, opacity: hover === null || hover === i ? 1 : 0.5 }} />
                <div style={{ height: `${rank * 100}%`, background: IS_COLOR.rank, opacity: hover === null || hover === i ? 1 : 0.5 }} />
                <div className="rounded-t-sm" style={{ height: `${budget * 100}%`, background: IS_COLOR.budget, opacity: hover === null || hover === i ? 1 : 0.5 }} />
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{shortDay(valid[0].date)}</span>
          <span>{shortDay(valid.at(-1)!.date)}</span>
        </div>
        {h && (
          <div className="pointer-events-none absolute -top-2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `${(hover! / valid.length) * 100}%`, transform: `translate(${hover! > valid.length / 2 ? "-105%" : "8%"}, -100%)` }}>
            <p className="text-muted-foreground">{shortDay(h.date)}</p>
            <p>Won {pct(h.share)} · Lost to rank {pct(h.lostRank)} · Lost to budget {pct(h.lostBudget)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

type Term = BreakdownRow & { isKeyword: boolean }

export function CampaignDetailData({ data, currency, target }: { data: CampaignBreakdowns; currency: string; target: number | null }) {
  if (data.kind === "google") return <GoogleDetail data={data} currency={currency} target={target} />
  if (data.kind === "linkedin") return <LinkedInDetail data={data} currency={currency} />
  return <MetaDetail data={data} currency={currency} />
}

function GoogleDetail({ data, currency, target }: { data: Extract<CampaignBreakdowns, { kind: "google" }>; currency: string; target: number | null }) {
  const [tab, setTab] = useState<"terms" | "keywords" | "share">("terms")
  const flag = (t: Term) => {
    if (target !== null && t.m.results === 0 && t.m.spend >= 2 * target) return <span className="rounded-full border border-rag-red/40 px-1.5 py-px text-[10px] text-rag-red">Negative?</span>
    if (!t.isKeyword && t.m.results >= 2) return <span className="rounded-full border border-lime/40 px-1.5 py-px text-[10px] text-lime">Add as keyword?</span>
    if (t.isKeyword) return <span className="text-[10px] text-subtle-foreground">keyword</span>
    return null
  }
  const termCols: Col<Term>[] = [
    { key: "term", label: "Search term", value: (r) => r.dim1, render: (r) => <span className="flex items-center gap-2"><span className="max-w-72 truncate" title={r.dim1}>{r.dim1}</span>{flag(r)}</span> },
    { key: "match", label: "Match", value: (r) => r.dim2, render: (r) => <span className="text-xs text-muted-foreground">{r.dim2.toLowerCase().replace(/_/g, " ")}</span> },
    ...(metricCols(currency) as Col<Term>[]),
  ]
  const kwCols: Col<BreakdownRow>[] = [
    { key: "kw", label: "Keyword", value: (r) => r.dim1, render: (r) => <span className="max-w-72 truncate" title={r.dim1}>{r.dim1}</span> },
    { key: "match", label: "Match", value: (r) => r.dim2, render: (r) => <span className="text-xs text-muted-foreground">{r.dim2.toLowerCase()}</span> },
    { key: "qs", label: "Quality score", align: "right", value: (r) => (r.extra?.quality_score as number | null) ?? null, render: (r) => { const q = r.extra?.quality_score as number | null; return q ? <span className={cn(q <= 4 && "text-rag-red")}>{q}/10</span> : "–" } },
    ...(metricCols(currency) as Col<BreakdownRow>[]),
  ]
  return (
    <div className="surface overflow-hidden">
      <div className="border-b px-4 py-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "terms", label: data.termsTotal > data.terms.length ? "Search terms (top 1,000 by spend)" : "Search terms", count: data.termsTotal },
            { key: "keywords", label: "Keywords", count: data.keywords.length },
            { key: "share", label: "Impression share" },
          ]}
        />
      </div>
      {tab === "terms" && <DataTable rows={data.terms} cols={termCols} search={(r) => r.dim1} empty="No search terms in this period." initial="spend" rowKey={(r) => `${r.groupId}|${r.dim1}|${r.dim2}`} />}
      {tab === "keywords" && <DataTable rows={data.keywords} cols={kwCols} search={(r) => r.dim1} empty="No keywords in this period." initial="spend" rowKey={(r) => `${r.groupId}|${r.dim1}|${r.dim2}`} />}
      {tab === "share" && <ImpressionShare days={data.share} />}
    </div>
  )
}

const LI_TABS: { key: LinkedInKind; label: string; dim: string }[] = [
  { key: "li_company", label: "Companies", dim: "Company" },
  { key: "li_job_title", label: "Job titles", dim: "Job title" },
  { key: "li_seniority", label: "Seniority", dim: "Seniority" },
  { key: "li_industry", label: "Industries", dim: "Industry" },
  { key: "li_job_function", label: "Job functions", dim: "Job function" },
]

function LinkedInDetail({ data, currency }: { data: Extract<CampaignBreakdowns, { kind: "linkedin" }>; currency: string }) {
  const [tab, setTab] = useState<LinkedInKind>("li_company")
  const g = data.groups[tab]
  const def = LI_TABS.find((t) => t.key === tab)!
  const cols: Col<BreakdownRow>[] = [{ key: "name", label: def.dim, value: (r) => r.dim1, render: (r) => <span className="max-w-72 truncate" title={r.dim1}>{r.dim1}</span> }, ...(metricCols(currency) as Col<BreakdownRow>[])]
  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <Tabs value={tab} onChange={setTab} tabs={LI_TABS.map((t) => ({ key: t.key, label: t.label, count: data.groups[t.key]?.rows.length }))} />
        <p className="text-[11px] text-muted-foreground">{g ? `30 days to ${shortDay(g.asOf)} · LinkedIn only reports groups above its privacy minimum` : "Not synced yet (refreshed weekly)"}</p>
      </div>
      {g ? <DataTable rows={g.rows} cols={cols} search={(r) => r.dim1} empty="Nothing reported for this campaign." initial="impressions" rowKey={(r) => r.dim1} /> : <p className="px-5 py-6 text-sm text-muted-foreground">The weekly LinkedIn breakdown hasn&apos;t run for this yet.</p>}
    </div>
  )
}

function MetaDetail({ data, currency }: { data: Extract<CampaignBreakdowns, { kind: "meta" }>; currency: string }) {
  const [tab, setTab] = useState<"age" | "placement" | "adsets">("age")
  const ageCols: Col<BreakdownRow>[] = [
    { key: "age", label: "Age", value: (r) => r.dim1 },
    { key: "gender", label: "Gender", value: (r) => r.dim2, render: (r) => <span className="text-muted-foreground">{r.dim2}</span> },
    ...(metricCols(currency) as Col<BreakdownRow>[]),
  ]
  const placeCols: Col<BreakdownRow>[] = [
    { key: "pub", label: "Platform", value: (r) => r.dim1, render: (r) => <span className="capitalize">{r.dim1}</span> },
    { key: "pos", label: "Placement", value: (r) => r.dim2, render: (r) => <span className="text-muted-foreground">{r.dim2.replace(/_/g, " ")}</span> },
    ...(metricCols(currency) as Col<BreakdownRow>[]),
  ]
  const setCols: Col<BreakdownRow>[] = [
    { key: "name", label: "Ad set", value: (r) => r.groupName ?? r.dim1, render: (r) => <span className="max-w-72 truncate" title={r.groupName ?? r.dim1}>{r.groupName ?? r.dim1}</span> },
    { key: "freq", label: "Frequency (last day)", align: "right", value: (r) => Number(r.extra?.frequency ?? 0) || null, render: (r) => { const f = Number(r.extra?.frequency ?? 0); return f ? <span className={cn(f > 4 && "text-rag-red")}>{f.toFixed(1)}</span> : "–" } },
    { key: "learning", label: "Learning", value: (r) => String(r.extra?.adset_learning_stage_info ?? ""), render: (r) => { const s = String(r.extra?.adset_learning_stage_info ?? ""); return <span className={cn("text-xs", s === "FAIL" ? "text-rag-red" : s === "LEARNING" ? "text-rag-amber" : "text-muted-foreground")}>{s === "FAIL" ? "Learning limited" : s ? s.toLowerCase() : "–"}</span> } },
    ...(metricCols(currency, false) as Col<BreakdownRow>[]),
  ]
  return (
    <div className="surface overflow-hidden">
      <div className="border-b px-4 py-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "age", label: "Age and gender", count: data.ageGender.length },
            { key: "placement", label: "Placements", count: data.placement.length },
            { key: "adsets", label: "Ad sets", count: data.adsets.length },
          ]}
        />
      </div>
      {tab === "age" && <DataTable rows={data.ageGender} cols={ageCols} empty="No age and gender data in this period." initial="spend" rowKey={(r) => `${r.groupId}|${r.dim1}|${r.dim2}`} />}
      {tab === "placement" && <DataTable rows={data.placement} cols={placeCols} empty="No placement data in this period." initial="spend" rowKey={(r) => `${r.dim1}|${r.dim2}`} />}
      {tab === "adsets" && <DataTable rows={data.adsets} cols={setCols} empty="No ad sets in this period." initial="spend" rowKey={(r) => r.groupId || r.dim1} />}
    </div>
  )
}

const isPaidSearch = (sm: string) => /(google|bing) \/ (cpc|ppc|paid)/i.test(sm)
const isPaidSocial = (sm: string) => /(linkedin|facebook|meta|instagram|fb|ig|reddit|x|twitter) \/ (cpc|paid|paid-social|paid_social|social-paid)/i.test(sm) || /paid[-_ ]social/i.test(sm)

/** GA4 landing pages: sessions, engagement and conversions, filterable to paid search or paid social. */
export function LandingPages({ rows }: { rows: LandingPage[] }) {
  const [filter, setFilter] = useState<"paid_search" | "paid_social" | "all">("paid_search")
  const list = rows.filter((r) => (filter === "all" ? true : filter === "paid_search" ? isPaidSearch(r.sourceMedium) : isPaidSocial(r.sourceMedium)))
  const cols: Col<LandingPage>[] = [
    { key: "page", label: "Landing page", value: (r) => r.page, render: (r) => <span className="max-w-80 truncate" title={r.page}>{r.page || "(not set)"}</span> },
    { key: "sm", label: "Source / medium", value: (r) => r.sourceMedium, render: (r) => <span className="text-xs text-muted-foreground">{r.sourceMedium}</span> },
    { key: "sessions", label: "Sessions", align: "right", value: (r) => r.sessions, render: (r) => r.sessions.toLocaleString("en-GB") },
    { key: "eng", label: "Engagement rate", align: "right", value: (r) => (r.sessions ? r.engaged / r.sessions : null), render: (r) => pct(r.sessions ? r.engaged / r.sessions : null, 1) },
    { key: "conv", label: "Conversions", align: "right", value: (r) => r.conversions, render: (r) => r.conversions.toLocaleString("en-GB", { maximumFractionDigits: 1 }) },
    { key: "cvr", label: "Conversion rate", align: "right", value: (r) => (r.sessions ? r.conversions / r.sessions : null), render: (r) => pct(r.sessions ? r.conversions / r.sessions : null, 2) },
    { key: "dur", label: "Avg. time", align: "right", value: (r) => r.avgDuration, render: (r) => (r.avgDuration === null ? "–" : `${Math.floor(r.avgDuration / 60)}m ${Math.round(r.avgDuration % 60)}s`) },
  ]
  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">
          Landing pages <span className="ml-1 text-xs font-normal text-muted-foreground">GA4</span>
        </h3>
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { key: "paid_search", label: "Paid search", count: rows.filter((r) => isPaidSearch(r.sourceMedium)).length },
            { key: "paid_social", label: "Paid social", count: rows.filter((r) => isPaidSocial(r.sourceMedium)).length },
            { key: "all", label: "All traffic", count: rows.length },
          ]}
        />
      </div>
      <DataTable rows={list} cols={cols} search={(r) => `${r.page} ${r.sourceMedium}`} empty="No landing page sessions for this filter." initial="sessions" rowKey={(r) => `${r.page}|${r.sourceMedium}`} />
    </div>
  )
}
