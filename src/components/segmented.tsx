"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Segmented control whose highlight slides to the selected option (like Linear / Vercel / Stripe).
 * `tone="lime"` fills the selection with the brand lime; `"quiet"` uses a raised surface.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  tone = "lime",
  size = "sm",
}: {
  label: string
  value: T
  options: { value: T; label: React.ReactNode; count?: number; title?: string }[]
  onChange: (v: T) => void
  tone?: "lime" | "quiet"
  size?: "sm" | "md"
}) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({})
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = refs.current[value]
    // Nothing selected (e.g. a date range the quick options don't cover): no highlight.
    if (!el) return setThumb(null)
    const measure = () => setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    measure()
    // Counts and fonts can change the widths after the first paint.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [value])
  const lime = tone === "lime"
  return (
    <div className="relative inline-flex rounded-lg bg-background/60 p-0.5 ring-1 ring-border" role="radiogroup" aria-label={label}>
      {thumb && (
        <span
          className={cn("absolute top-0.5 bottom-0.5 rounded-md shadow-sm transition-all duration-300 ease-out motion-reduce:transition-none", lime ? "bg-lime" : "bg-secondary ring-1 ring-foreground/10")}
          style={{ left: thumb.left, width: thumb.width }}
          aria-hidden
        />
      )}
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[o.value] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-md font-medium tabular-nums transition-colors duration-300",
              size === "sm" ? "h-7 min-w-11 px-3 text-xs" : "h-8 px-3.5 text-sm",
              active ? (lime ? "text-primary-foreground" : "text-foreground") : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn("rounded-full px-1.5 text-[10px] leading-4 tabular-nums", active ? (lime ? "bg-black/15" : "bg-foreground/10 text-foreground") : "bg-secondary text-muted-foreground")}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** A filter chip: a color tint when active (e.g. the platform's color), a quiet hover otherwise. */
export function FilterChip({ active, color, onClick, title, children }: { active: boolean; color?: string; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      onClick={onClick}
      style={active && color ? { backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, borderColor: `color-mix(in oklab, ${color} 55%, transparent)` } : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all duration-200 active:scale-[0.97]",
        active ? (color ? "text-foreground" : "border-foreground/25 bg-secondary text-foreground") : "border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
