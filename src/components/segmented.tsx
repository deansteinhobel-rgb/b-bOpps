"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * A row of options whose selection is the app's one mark: a 1px lime line under the selected label,
 * sliding to it (taste skill "data terminal", Dean 2026-10-21). No track, no filled pill. `tone` is
 * kept for callers and no longer changes the look.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "sm",
}: {
  label: string
  value: T
  options: { value: T; label: React.ReactNode; count?: number; title?: string }[]
  onChange: (v: T) => void
  tone?: "lime" | "quiet"
  size?: "sm" | "md"
}) {
  const refs = useRef<Partial<Record<T, HTMLSpanElement | null>>>({})
  const [line, setLine] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = refs.current[value]
    // Nothing selected (e.g. a date range the quick options don't cover): no line.
    if (!el) return setLine(null)
    // The line is as wide as the label, measured inside the padded button.
    const measure = () => {
      const button = el.parentElement as HTMLElement
      setLine({ left: button.offsetLeft + el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    // Counts and fonts can change the widths after the first paint.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [value])
  return (
    <div className="relative inline-flex items-center" role="radiogroup" aria-label={label}>
      {line && <span className="pointer-events-none absolute bottom-0 h-px bg-lime transition-[left,width] duration-200 ease-out motion-reduce:transition-none" style={line} aria-hidden />}
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center justify-center rounded-sm tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "h-8 px-2 text-[13px]" : "h-9 px-2.5 text-sm",
              active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              ref={(el) => {
                refs.current[o.value] = el
              }}
              className="inline-flex items-center gap-1.5"
            >
              {o.label}
              {o.count !== undefined && <span className={cn("rounded px-1 text-[11px] leading-4 tabular-nums", active ? "bg-white/[0.12] text-foreground" : "bg-white/[0.06] text-muted-foreground")}>{o.count}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A filter option: white text and the 1px lime line when active, like every other selection. `color`
 * (a platform's or segment's) is accepted for callers; the logo beside the label carries the identity.
 */
export function FilterChip({ active, onClick, title, children }: { active: boolean; color?: string; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-sm px-2 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("inline-flex h-full items-center gap-1.5", active && "select-line")}>{children}</span>
    </button>
  )
}
