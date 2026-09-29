"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { fieldClass } from "@/components/field-class"
import { PlatformIcon, PlatformLabel } from "@/components/brand"
import { money, whole } from "@/lib/format"
import { change, DRIVERS, fmt, METRIC, tone, type Derived, type MetricKey } from "@/lib/metrics/performance"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"

/** Platform colours (validated for the dark surface: lightness band, chroma, colour-blind separation). Always shown with the platform's logo and name. */
export const PLATFORM_COLOR: Record<Platform, string> = { linkedin: "#7f6ae0", google_ads: "#869a14", meta: "#cf4f86" }


export function Delta({ k, now, before, className }: { k: MetricKey; now: number | null; before: number | null; className?: string }) {
  const pct = change(now, before)
  const t = tone(k, pct)
  if (pct === null) return <span className={cn("text-xs text-subtle-foreground", className)}>–</span>
  const Icon = Math.abs(pct) < 0.5 ? Minus : pct > 0 ? ArrowUp : ArrowDown
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs tabular-nums", t === "good" ? "text-rag-green" : t === "bad" ? "text-rag-red" : "text-muted-foreground", className)} title={t === "neutral" ? "Change vs the previous period" : `${t === "good" ? "Better" : "Worse"} than the previous period`}>
      <Icon className="size-3" aria-hidden />
      {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%
    </span>
  )
}

/** A small trend line with no axes, for metric cards and table rows. */
export function Sparkline({ values, className }: { values: (number | null)[]; className?: string }) {
  const v = values.map((x) => x ?? 0)
  const max = Math.max(...v, 0)
  const min = Math.min(...v, 0)
  if (v.length < 2 || max === min) return <svg viewBox="0 0 100 24" className={className} aria-hidden />
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * 100},${22 - ((y - min) / (max - min)) * 20}`).join(" ")
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke="#e4ff1a" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
    </svg>
  )
}

/** Why a metric moved: the metric on top, the two parts that make it up below. */
export function Investigator({ now, prev, currency }: { now: Derived; prev: Derived; currency: string }) {
  const [k, setK] = useState<MetricKey>("results")
  const [a, b, op] = DRIVERS[k]!
  const box = (m: MetricKey, big = false) => {
    const pct = change(now[m], prev[m])
    const t = tone(m, pct)
    return (
      <div className={cn("rounded-lg border px-4 py-3 text-center", t === "good" ? "border-rag-green/30 bg-rag-green/[0.08]" : t === "bad" ? "border-rag-red/30 bg-rag-red/[0.08]" : "bg-background/40")}>
        <Delta k={m} now={now[m]} before={prev[m]} className={cn("justify-center font-semibold", big ? "text-lg" : "text-sm")} />
        <p className={cn("mt-0.5", big ? "text-base font-semibold" : "text-sm")}>{METRIC[m].label}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {fmt(m, now[m], currency)} <span className="text-subtle-foreground">vs {fmt(m, prev[m], currency)}</span>
        </p>
      </div>
    )
  }
  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Why did it move?</h3>
        <select aria-label="Metric to investigate" className={cn(fieldClass, "h-8 w-44")} value={k} onChange={(e) => setK(e.target.value as MetricKey)}>
          {(Object.keys(DRIVERS) as MetricKey[]).map((m) => (
            <option key={m} value={m}>
              {METRIC[m].label}
            </option>
          ))}
        </select>
      </div>
      <div className="mx-auto mt-4 w-full max-w-56">{box(k, true)}</div>
      {/* Connectors */}
      <div aria-hidden className="mx-auto flex h-6 w-2/3 items-end">
        <div className="h-3 flex-1 rounded-tl-md border-t border-l border-foreground/20" />
        <div className="h-6 w-px bg-foreground/20" />
        <div className="h-3 flex-1 rounded-tr-md border-t border-r border-foreground/20" />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {box(a)}
        <span className="text-lg text-muted-foreground" aria-label={op === "×" ? "times" : "divided by"}>
          {op}
        </span>
        {box(b)}
      </div>
    </div>
  )
}

type Point = { date: string } & Derived
const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso))

/** One metric over the period, with the previous period dashed behind it, and a hover crosshair. */
function TrendChart({ k, daily, prevDaily, currency }: { k: MetricKey; daily: Point[]; prevDaily: Point[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const W = 600
  const H = 150
  const pad = { l: 44, r: 8, t: 10, b: 22 }
  const now = daily.map((d) => d[k])
  const before = prevDaily.map((d) => d[k])
  const all = [...now, ...before].filter((v): v is number => v !== null)
  const max = Math.max(...all, 0) * 1.1 || 1
  const x = (i: number) => pad.l + (i / Math.max(daily.length - 1, 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const line = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ")
  const ticks = [0, max / 2, max]
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(daily.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (daily.length - 1)))))
  }
  const h = hover === null ? null : daily[hover]
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${METRIC[k].label} by day, this period against the previous period`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity="0.08" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.5">
              {fmt(k, t, currency)}
            </text>
          </g>
        ))}
        {[0, Math.floor((daily.length - 1) / 2), daily.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === daily.length - 1 ? "end" : "middle"} fontSize="10" fill="currentColor" opacity="0.5">
            {shortDay(daily[i].date)}
          </text>
        ))}
        <polyline points={line(before)} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 4" />
        <polyline points={line(now)} fill="none" stroke="#e4ff1a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="currentColor" strokeOpacity="0.3" />
            {now[hover] !== null && <circle cx={x(hover)} cy={y(now[hover]!)} r="4" fill="#e4ff1a" stroke="#131313" strokeWidth="2" />}
          </>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${hover! > daily.length / 2 ? "-105%" : "5%"})` }}>
          <p className="text-muted-foreground">{shortDay(h.date)}</p>
          <p className="tabular-nums">
            {fmt(k, h[k], currency)} <span className="text-muted-foreground">this period</span>
          </p>
          <p className="tabular-nums text-muted-foreground">
            {fmt(k, prevDaily[hover!]?.[k] ?? null, currency)} {prevDaily[hover!] ? `(${shortDay(prevDaily[hover!].date)})` : ""}
          </p>
        </div>
      )}
    </div>
  )
}

/** Two metrics as two charts on one timeline (never two y-axes on one chart). */
export function TrendPanel({ daily, prevDaily, currency }: { daily: Point[]; prevDaily: Point[]; currency: string }) {
  const [a, setA] = useState<MetricKey>("clicks")
  const [b, setB] = useState<MetricKey>("cpr")
  const pick = (v: MetricKey, set: (k: MetricKey) => void, label: string) => (
    <select aria-label={label} className={cn(fieldClass, "h-8 w-40")} value={v} onChange={(e) => set(e.target.value as MetricKey)}>
      {(Object.keys(METRIC) as MetricKey[]).map((m) => (
        <option key={m} value={m}>
          {METRIC[m].label}
        </option>
      ))}
    </select>
  )
  return (
    <div className="surface space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Metric comparison</h3>
        <p className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-lime" /> This period
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-foreground/40" /> Previous period
          </span>
        </p>
      </div>
      <div className="space-y-1">
        {pick(a, setA, "First metric")}
        <TrendChart k={a} daily={daily} prevDaily={prevDaily} currency={currency} />
      </div>
      <div className="space-y-1 border-t pt-3">
        {pick(b, setB, "Second metric")}
        <TrendChart k={b} daily={daily} prevDaily={prevDaily} currency={currency} />
      </div>
    </div>
  )
}

/** Share of spend and of results by platform, as two 100% bars with direct labels. */
export function PlatformSplit({ platforms, currency }: { platforms: { platform: Platform; now: Derived }[]; currency: string }) {
  const order: Platform[] = ["linkedin", "google_ads", "meta"]
  const list = order.map((p) => platforms.find((x) => x.platform === p)).filter((x): x is { platform: Platform; now: Derived } => Boolean(x))
  const bar = (key: "spend" | "results", label: string) => {
    const total = list.reduce((s, p) => s + p.now[key], 0)
    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">{key === "spend" ? money(total, currency) : whole(total)}</span>
        </div>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${label}: ${list.map((p) => `${PLATFORM_LABEL[p.platform]} ${total ? Math.round((p.now[key] / total) * 100) : 0}%`).join(", ")}`}>
          {list.map((p) =>
            p.now[key] > 0 ? <div key={p.platform} className="first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.now[key] / total) * 100}%`, background: PLATFORM_COLOR[p.platform] }} title={`${PLATFORM_LABEL[p.platform]}: ${Math.round((p.now[key] / total) * 100)}%`} /> : null,
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {list.map((p) => (
            <span key={p.platform} className="inline-flex items-center gap-1.5">
              <PlatformIcon platform={p.platform} className="size-3.5" />
              <span className="tabular-nums">{total ? Math.round((p.now[key] / total) * 100) : 0}%</span>
            </span>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="surface space-y-5 p-5">
      <h3 className="text-sm font-semibold">Platform split</h3>
      {bar("spend", "Share of spend")}
      {bar("results", "Share of results")}
      <table className="w-full text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">Platform</th>
            <th className="py-1 text-right font-normal">Spend</th>
            <th className="py-1 text-right font-normal">Results</th>
            <th className="py-1 text-right font-normal">Cost per result</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.platform} className="border-t">
              <td className="py-1.5">
                <PlatformLabel platform={p.platform} />
              </td>
              <td className="py-1.5 text-right">{money(p.now.spend, currency)}</td>
              <td className="py-1.5 text-right">{whole(p.now.results)}</td>
              <td className="py-1.5 text-right">{fmt("cpr", p.now.cpr, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type CampaignRow = { platform: Platform; campaignId: string; name: string; now: Derived; prev: Derived; daily: { date: string; spend: number; results: number }[]; live: boolean }
const COLS: { k: MetricKey; label: string }[] = [
  { k: "spend", label: "Spend" },
  { k: "impressions", label: "Impr." },
  { k: "clicks", label: "Clicks" },
  { k: "ctr", label: "CTR" },
  { k: "cpc", label: "CPC" },
  { k: "results", label: "Results" },
  { k: "cpr", label: "Cost / result" },
]

/** Every campaign in the period: sortable, searchable, each row opens its drill-down. */
export function CampaignTable({ rows, currency, slug, query, target }: { rows: CampaignRow[]; currency: string; slug: string; query: string; target: number | null }) {
  const [sort, setSort] = useState<{ k: MetricKey; dir: 1 | -1 }>({ k: "spend", dir: -1 })
  const [q, setQ] = useState("")
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows
      .filter((r) => !needle || r.name.toLowerCase().includes(needle))
      .sort((a, b) => ((a.now[sort.k] ?? -Infinity) - (b.now[sort.k] ?? -Infinity)) * sort.dir)
  }, [rows, q, sort])
  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">
          Campaigns <span className="ml-1 text-xs font-normal text-muted-foreground">{rows.length}</span>
        </h3>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns" aria-label="Search campaigns" className="h-8 w-56 rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 text-left font-normal">Campaign</th>
              {COLS.map((c) => (
                <th key={c.k} className="px-3 py-2 text-right font-normal">
                  <button type="button" onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cn("hover:text-foreground", sort.k === c.k && "text-foreground")} aria-label={`Sort by ${c.label}`}>
                    {c.label}
                    {sort.k === c.k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th className="px-4 py-2 text-right font-normal">Spend trend</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => {
              const over = target !== null && r.now.cpr !== null && r.now.cpr > target
              return (
                <tr key={`${r.platform}|${r.campaignId}`} className="group hover:bg-accent/40">
                  <td className="max-w-80 px-4 py-2.5">
                    <Link href={`/clients/${slug}/performance/${r.platform}/${encodeURIComponent(r.campaignId)}${query}`} className="flex items-center gap-2">
                      <PlatformIcon platform={r.platform} className="size-3.5 shrink-0" />
                      <span className="truncate group-hover:underline" title={r.name}>
                        {r.name}
                      </span>
                      <span className={cn("size-1.5 shrink-0 rounded-full", r.live ? "bg-rag-green" : "bg-rag-na")} title={r.live ? "Spending" : "No spend in the last 2 days"} aria-label={r.live ? "Spending" : "No spend in the last 2 days"} />
                    </Link>
                  </td>
                  {COLS.map((c) => (
                    <td key={c.k} className="px-3 py-2.5 text-right">
                      <span className={cn(c.k === "cpr" && over && "text-rag-red")} title={c.k === "cpr" && over ? "Above the cost per result target" : undefined}>
                        {fmt(c.k, r.now[c.k], currency)}
                      </span>
                      {(c.k === "cpr" || c.k === "results" || c.k === "ctr") && (
                        <span className="block">
                          <Delta k={c.k} now={r.now[c.k]} before={r.prev[c.k]} className="text-[10px]" />
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-2.5">
                    <Sparkline values={r.daily.map((d) => d.spend)} className="ml-auto h-6 w-24" />
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 2} className="px-4 py-8 text-center text-muted-foreground">
                  No campaigns match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
