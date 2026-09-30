import Link from "next/link"
import { PlatformLabel } from "@/components/brand"
import { money, whole } from "@/lib/format"
import { fmt, METRIC, type MetricKey } from "@/lib/metrics/performance"
import type { SegmentTotals } from "@/lib/metrics/segments"
import { cn } from "@/lib/utils"
import { Delta } from "./charts"

const SEGMENT_TONE = ["bg-violet", "bg-lavender", "bg-muted-foreground/40"]
const ROWS: MetricKey[] = ["spend", "results", "cpr", "ctr", "cpc"]

/**
 * SMB vs ABX (Dean, 2026-09-30): each segment's campaigns added up across platforms, side by side,
 * with each platform's share under it. Follows the page's period and platform. "Only SMB" narrows
 * the whole page to that segment.
 */
export function SegmentSplit({ segments, currency, base, query, active }: { segments: SegmentTotals[]; currency: string; base: string; query: URLSearchParams; active: string | null }) {
  const total = segments.reduce((s, x) => s + x.now.spend, 0)
  const href = (key: string | null) => {
    const q = new URLSearchParams(query)
    if (key) q.set("segment", key)
    else q.delete("segment")
    return `${base}${q.size ? `?${q}` : ""}#segments`
  }
  return (
    <div className="surface overflow-hidden">
      {total > 0 && (
        <div className="space-y-2 border-b px-4 py-3">
          <p className="text-xs text-muted-foreground">Share of spend</p>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {segments.map((s, i) => (s.now.spend > 0 ? <div key={s.key} className={cn("first:rounded-l-full last:rounded-r-full", SEGMENT_TONE[i % SEGMENT_TONE.length])} style={{ width: `${(s.now.spend / total) * 100}%` }} title={`${s.label}: ${Math.round((s.now.spend / total) * 100)}%`} /> : null))}
          </div>
        </div>
      )}
      <div className={cn("grid divide-y md:divide-x md:divide-y-0", segments.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {segments.map((s, i) => (
          <div key={s.key} className={cn("space-y-4 p-4", active === s.key && "bg-secondary/30")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <span className={cn("size-2.5 rounded-full", SEGMENT_TONE[i % SEGMENT_TONE.length])} aria-hidden />
                  {s.label}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {total > 0 ? `${Math.round((s.now.spend / total) * 100)}% of spend` : "No spend"} · {s.hint.replace(/^Campaigns /, "campaigns ")}
                </p>
              </div>
              {active === s.key ? (
                <Link href={href(null)} scroll={false} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
                  Show all
                </Link>
              ) : (
                <Link href={href(s.key)} scroll={false} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
                  Only {s.label} →
                </Link>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-3 sm:grid-cols-5 md:grid-cols-3 xl:grid-cols-5">
              {ROWS.map((k) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k === "cpr" ? "Cost / result" : METRIC[k].label}</dt>
                  <dd className="mt-0.5 font-heading text-lg leading-tight tabular-nums">{fmt(k, s.now[k], currency)}</dd>
                  <Delta k={k} now={s.now[k]} before={s.prev[k]} />
                </div>
              ))}
            </dl>
            {s.platforms.length > 0 && (
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 text-left font-normal">Platform</th>
                    <th className="py-1.5 text-right font-normal">Spend</th>
                    <th className="py-1.5 text-right font-normal">Results</th>
                    <th className="py-1.5 text-right font-normal">Cost / result</th>
                  </tr>
                </thead>
                <tbody className="divide-y border-t">
                  {s.platforms.map((p) => (
                    <tr key={p.platform}>
                      <td className="py-2">
                        <PlatformLabel platform={p.platform} />
                      </td>
                      <td className="py-2 text-right">{money(p.now.spend, currency)}</td>
                      <td className="py-2 text-right">{whole(p.now.results)}</td>
                      <td className="py-2 text-right">{fmt("cpr", p.now.cpr, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
