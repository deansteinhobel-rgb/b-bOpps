"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { PlatformIcon } from "@/components/brand"
import { FilterChip, Segmented } from "@/components/segmented"
import { money } from "@/lib/format"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"
import { PLATFORM_COLOR } from "./charts"
import { PERIODS } from "./params"

type PlatformOption = { platform: Platform; spend: number }

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso))
const PLATFORM_KEYS: Record<string, Platform> = { l: "linkedin", g: "google_ads", m: "meta" }

/**
 * The Performance toolbar (Dean: modern, easy on the eye, quick to act): a segmented period control
 * with a sliding highlight, platform chips in their platform colour with this period's spend, the
 * date range being compared, and "copy link". The URL holds the view; switching shows a loading bar
 * straight away. Keys: 1–4 pick the period, A / L / G / M the platform.
 */
export function Controls({ base, days, platform, platforms, currency, from, to, prevFrom, prevTo }: { base: string; days: number; platform: Platform | null; platforms?: PlatformOption[]; currency?: string; from: string; to: string; prevFrom?: string; prevTo?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  // Optimistic: the highlight moves on click, before the new numbers arrive.
  const [view, setView] = useState({ days, platform })
  // When the URL catches up (or changes by Back / Forward), follow it.
  const [seen, setSeen] = useState({ days, platform })
  if (seen.days !== days || seen.platform !== platform) {
    setSeen({ days, platform })
    setView({ days, platform })
  }

  const go = (d: number, p: Platform | null) => {
    if (d === view.days && p === view.platform) return
    setView({ days: d, platform: p })
    const q = new URLSearchParams()
    if (d !== 30) q.set("days", String(d))
    if (p) q.set("platform", p)
    start(() => router.push(`${base}${q.size ? `?${q}` : ""}`, { scroll: false }))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return
      const n = Number(e.key)
      if (n >= 1 && n <= PERIODS.length) go(PERIODS[n - 1], view.platform)
      else if (platforms && e.key.toLowerCase() === "a") go(view.days, null)
      else if (platforms && PLATFORM_KEYS[e.key.toLowerCase()] && platforms.some((p) => p.platform === PLATFORM_KEYS[e.key.toLowerCase()])) go(view.days, PLATFORM_KEYS[e.key.toLowerCase()])
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
    <div className="surface relative flex flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden p-1.5">
      <Segmented
        label="Period"
        value={String(view.days)}
        options={PERIODS.map((d, i) => ({ value: String(d), label: d === 90 ? "90d" : `${d}d`, title: `Last ${d} days (press ${i + 1})` }))}
        onChange={(v) => go(Number(v), view.platform)}
      />

      {platforms && platforms.length > 0 && (
        <>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Platform">
            <FilterChip active={!view.platform} onClick={() => go(view.days, null)} title="All platforms (press A)">
              All
              {currency && <span className="tabular-nums text-muted-foreground">{money(platforms.reduce((s, p) => s + p.spend, 0), currency)}</span>}
            </FilterChip>
            {platforms.map((p) => (
              <FilterChip key={p.platform} active={view.platform === p.platform} color={PLATFORM_COLOR[p.platform]} onClick={() => go(view.days, p.platform)} title={`${PLATFORM_LABEL[p.platform]} only (press ${Object.keys(PLATFORM_KEYS).find((k) => PLATFORM_KEYS[k] === p.platform)!.toUpperCase()})`}>
                <PlatformIcon platform={p.platform} className="size-3.5" />
                {PLATFORM_LABEL[p.platform]}
                {currency && <span className="tabular-nums text-muted-foreground">{money(p.spend, currency)}</span>}
              </FilterChip>
            ))}
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-1 pl-1">
        <span className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs">
          <CalendarIcon />
          <span className="tabular-nums text-foreground">
            {day(from)} – {day(to)}
          </span>
          <span className="hidden text-muted-foreground md:inline">vs {prevFrom && prevTo ? `${day(prevFrom)} – ${day(prevTo)}` : `the ${days} days before`}</span>
        </span>
        <button type="button" onClick={copy} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="Copy a link to this view" aria-label="Copy a link to this view">
          <LinkIcon />
        </button>
      </div>

      {/* Loading bar while the new view loads. */}
      <span className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-lime transition-opacity", pending ? "animate-toolbar-load opacity-100" : "opacity-0")} aria-hidden />
      <span className="sr-only" aria-live="polite">
        {pending ? "Loading" : ""}
      </span>
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-3.5 text-muted-foreground" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
    </svg>
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
