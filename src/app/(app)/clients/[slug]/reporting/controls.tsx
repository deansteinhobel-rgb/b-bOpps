"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { PlatformIcon } from "@/components/brand"
import { FilterChip, Segmented } from "@/components/segmented"
import { RangePicker } from "@/components/range-picker"
import { money } from "@/lib/format"
import { QUICK_DAYS, rangeParams, sameRange, type Periods, type RangeSpec } from "@/lib/metrics/range"
import type { SegmentOption } from "@/lib/metrics/segments"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"
import { PLATFORM_COLOR } from "./charts"

type PlatformOption = { platform: Platform; spend: number }

const PLATFORM_KEYS: Record<string, Platform> = { l: "linkedin", g: "google_ads", m: "meta" }

/**
 * The Reporting toolbar (Dean: modern, easy on the eye, quick to act): quick 7/14/30/90 days with a
 * sliding highlight, the date range picker (presets and custom dates), platform chips in their
 * platform color with this range's spend, and "copy link". The URL holds the view; switching shows
 * a loading bar straight away. Keys: 1–4 pick the quick periods, A / L / G / M the platform.
 * Clients with campaign segments (e.g. Camber's SMB and ABX) also get a segment picker.
 */
export function Controls({ base, range, defaultDays = 30, platform, platforms, currency, periods, dataFrom, dataThrough, segment = null, segments = [] }: { base: string; range: RangeSpec; defaultDays?: number; platform: Platform | null; platforms?: PlatformOption[]; currency?: string; periods: Periods; dataFrom: string; dataThrough: string; segment?: string | null; segments?: SegmentOption[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  // Optimistic: the highlight moves on click, before the new numbers arrive.
  const [view, setView] = useState({ range, platform, segment })
  // When the URL catches up (or changes by Back / Forward), follow it.
  const [seen, setSeen] = useState({ range, platform, segment })
  if (!sameRange(seen.range, range) || seen.platform !== platform || seen.segment !== segment) {
    setSeen({ range, platform, segment })
    setView({ range, platform, segment })
  }

  const go = (r: RangeSpec, p: Platform | null, s: string | null = view.segment) => {
    if (sameRange(r, view.range) && p === view.platform && s === view.segment) return
    setView({ range: r, platform: p, segment: s })
    const q = rangeParams(r, new URLSearchParams(), defaultDays)
    if (p) q.set("platform", p)
    if (s) q.set("segment", s)
    start(() => router.push(`${base}${q.size ? `?${q}` : ""}`, { scroll: false }))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return
      const n = Number(e.key)
      if (n >= 1 && n <= QUICK_DAYS.length) go({ kind: "days", days: QUICK_DAYS[n - 1] }, view.platform)
      else if (platforms && e.key.toLowerCase() === "a") go(view.range, null)
      else if (platforms && PLATFORM_KEYS[e.key.toLowerCase()] && platforms.some((p) => p.platform === PLATFORM_KEYS[e.key.toLowerCase()])) go(view.range, PLATFORM_KEYS[e.key.toLowerCase()])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + pathname + window.location.search)
      toast.success("Link to this view copied.")
    } catch {
      toast.error("Couldn't copy the link.")
    }
  }

  return (
    <div className="surface relative flex flex-wrap items-center gap-x-3 gap-y-2 p-1.5">
      <Segmented
        label="Period"
        value={view.range.kind === "days" ? String(view.range.days) : ""}
        options={QUICK_DAYS.map((d, i) => ({ value: String(d), label: `${d}d`, title: `Last ${d} days (press ${i + 1})` }))}
        onChange={(v) => go({ kind: "days", days: Number(v) }, view.platform)}
      />

      {platforms && platforms.length > 0 && (
        <>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Platform">
            <FilterChip active={!view.platform} onClick={() => go(view.range, null)} title="All platforms (press A)">
              All
              {currency && <span className="tabular-nums text-muted-foreground">{money(platforms.reduce((s, p) => s + p.spend, 0), currency)}</span>}
            </FilterChip>
            {platforms.map((p) => (
              <FilterChip key={p.platform} active={view.platform === p.platform} color={PLATFORM_COLOR[p.platform]} onClick={() => go(view.range, p.platform)} title={`${PLATFORM_LABEL[p.platform]} only (press ${Object.keys(PLATFORM_KEYS).find((k) => PLATFORM_KEYS[k] === p.platform)!.toUpperCase()})`}>
                <PlatformIcon platform={p.platform} className="size-3.5" />
                {PLATFORM_LABEL[p.platform]}
                {currency && <span className="tabular-nums text-muted-foreground">{money(p.spend, currency)}</span>}
              </FilterChip>
            ))}
          </div>
        </>
      )}

      {segments.length > 0 && (
        <>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Segment">
            <FilterChip active={!view.segment} onClick={() => go(view.range, view.platform, null)} title="Every campaign">
              All segments
            </FilterChip>
            {segments.map((s) => (
              <FilterChip key={s.key} active={view.segment === s.key} color={s.color} onClick={() => go(view.range, view.platform, s.key)} title={s.hint}>
                <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
              </FilterChip>
            ))}
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-1 pl-1">
        <RangePicker range={view.range} periods={periods} dataFrom={dataFrom} dataThrough={dataThrough} onChange={(r) => go(r, view.platform)} />
        <button type="button" onClick={copy} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="Copy a link to this view" aria-label="Copy a link to this view">
          <LinkIcon />
        </button>
      </div>

      {/* Loading bar while the new view loads. */}
      {/* Clipped on its own, so the date range panel can open outside the toolbar. */}
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden>
        <span className={cn("absolute inset-x-0 bottom-0 h-0.5 origin-left bg-lime transition-opacity", pending ? "animate-toolbar-load opacity-100" : "opacity-0")} />
      </span>
      <span className="sr-only" aria-live="polite">
        {pending ? "Loading" : ""}
      </span>
    </div>
  )
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="size-4" aria-hidden>
      <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.1-2.1a3 3 0 0 0-4.2-4.2l-.7.7" />
      <path d="M9.5 6.5a3 3 0 0 0-4.2 0L3.2 8.6a3 3 0 0 0 4.2 4.2l.7-.7" />
    </svg>
  )
}
