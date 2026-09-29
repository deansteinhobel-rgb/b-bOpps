"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { PlatformIcon } from "@/components/brand"
import { FilterChip, Segmented } from "@/components/segmented"
import { Input } from "@/components/ui/input"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import type { TimelineEntry, TimelineSource } from "@/lib/timeline"
import { cn } from "@/lib/utils"
import { PLATFORM_COLOR } from "../performance/charts"

type SourceFilter = "all" | TimelineSource
const SOURCES: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "team", label: "Team log" },
  { value: "platform", label: "Platforms" },
  { value: "app", label: "In the app" },
]
const SOURCE_BADGE: Record<TimelineSource, { label: string; cls: string }> = {
  team: { label: "Team log", cls: "border-lime/40 bg-lime/10 text-lime" },
  platform: { label: "Platform", cls: "border-foreground/15 text-muted-foreground" },
  app: { label: "App", cls: "border-violet/40 bg-violet/10 text-violet" },
}
const PAGE = 60

const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(iso))
const timeLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(iso))
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso))

/**
 * The change history timeline: newest first, grouped by day, filterable by source, platform and a
 * search. Bulk platform changes (a tool changing thousands of things at once) can be hidden.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const [source, setSource] = useState<SourceFilter>("all")
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [query, setQuery] = useState("")
  const [hideBulk, setHideBulk] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const platforms = useMemo(() => (["google_ads", "linkedin", "meta"] as Platform[]).filter((p) => entries.some((e) => e.platform === p)), [entries])
  const bulkCount = entries.filter((e) => e.bulk).length
  const q = query.trim().toLowerCase()
  const shown = entries.filter(
    (e) =>
      (source === "all" || e.source === source) &&
      (!platform || e.platform === platform) &&
      (!hideBulk || !e.bulk) &&
      (!q || [e.title, e.detail, e.campaign, e.who, e.kind, e.via].some((x) => x?.toLowerCase().includes(q))),
  )
  const page = shown.slice(0, limit)
  const days: { key: string; label: string; items: TimelineEntry[] }[] = []
  for (const e of page) {
    const k = dayKey(e.at)
    const d = days.at(-1)
    if (d && d.key === k) d.items.push(e)
    else days.push({ key: k, label: dayLabel(e.at), items: [e] })
  }
  const counts = { team: entries.filter((e) => e.source === "team").length, platform: entries.filter((e) => e.source === "platform").length, app: entries.filter((e) => e.source === "app").length }

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Segmented
          label="Source"
          tone="quiet"
          value={source}
          onChange={(v) => {
            setSource(v)
            setLimit(PAGE)
          }}
          options={SOURCES.map((s) => ({ ...s, count: s.value === "all" ? entries.length : counts[s.value] }))}
        />
        {platforms.length > 1 && (
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Platform">
            <FilterChip active={!platform} onClick={() => setPlatform(null)}>
              All platforms
            </FilterChip>
            {platforms.map((p) => (
              <FilterChip key={p} active={platform === p} color={PLATFORM_COLOR[p]} onClick={() => setPlatform(platform === p ? null : p)}>
                <PlatformIcon platform={p} className="size-3.5" />
                {PLATFORM_LABEL[p]}
              </FilterChip>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {bulkCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" className="accent-lime" checked={hideBulk} onChange={(e) => setHideBulk(e.target.checked)} />
              Hide bulk changes ({bulkCount})
            </label>
          )}
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search changes, campaigns, people…" className="h-8 w-56" aria-label="Search the change history" />
        </div>
      </div>

      {days.length === 0 && <p className="px-5 py-12 text-center text-sm text-muted-foreground">{entries.length ? "Nothing matches these filters." : "No changes recorded in the last 60 days yet."}</p>}

      <ol>
        {days.map((d) => (
          <li key={d.key}>
            <p className="sticky top-0 z-10 border-b bg-card/95 px-5 py-2 text-xs font-medium text-muted-foreground backdrop-blur">{d.label}</p>
            <ul className="divide-y">
              {d.items.map((e) => (
                <Entry key={e.id} e={e} />
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(limit + PAGE)} className="w-full border-t px-5 py-3 text-sm text-muted-foreground hover:bg-secondary/40 hover:text-foreground">
          Show more ({shown.length - limit} older)
        </button>
      )}
    </div>
  )
}

function Entry({ e }: { e: TimelineEntry }) {
  const badge = SOURCE_BADGE[e.source]
  const meta = [e.who, e.via, e.campaign].filter(Boolean)
  const body = (
    <div className="flex items-start gap-3 px-5 py-3">
      <span className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{e.source === "team" ? "" : timeLabel(e.at)}</span>
      <span className="mt-0.5 shrink-0">{e.platform ? <PlatformIcon platform={e.platform} /> : <span className="inline-block size-4 rounded bg-secondary" aria-hidden />}</span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm leading-snug">
          <span className="font-medium">{e.title}</span>
          <span className={cn("rounded-full border px-1.5 py-px text-[10px]", badge.cls)}>{e.source === "platform" ? e.kind : badge.label}</span>
          {e.bulk && <span className="rounded-full border border-rag-amber/40 bg-rag-amber/10 px-1.5 py-px text-[10px] text-rag-amber">Bulk</span>}
        </span>
        {meta.length > 0 && <span className="block truncate text-xs text-muted-foreground">{meta.join(" · ")}</span>}
        {e.detail && <span className="block text-xs text-foreground/75">{e.detail}</span>}
        {e.campaigns && e.campaigns.length > 1 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">{e.campaigns.length} campaigns</summary>
            <span className="mt-1 block">{e.campaigns.join(" · ")}</span>
          </details>
        )}
      </span>
    </div>
  )
  return <li>{e.href ? <Link href={e.href} className="block hover:bg-secondary/30">{body}</Link> : body}</li>
}
