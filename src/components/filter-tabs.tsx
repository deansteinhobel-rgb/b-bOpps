"use client"

import { useRef } from "react"
import { cn } from "@/lib/utils"

/** A small neutral count next to a label (filters, section headings). */
export function CountBadge({ children, active, className }: { children: React.ReactNode; active?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-xs leading-none font-medium tabular-nums", active ? "bg-white/[0.14] text-foreground" : "bg-white/[0.06] text-muted-foreground", className)}>
      {children}
    </span>
  )
}

/**
 * Flat filters for a list (Dean, 2026-10-15: part of the list, not a capsule floating above it). The
 * selected one gets a quiet fill, medium weight and aria-checked, so it never relies on color. Arrow
 * keys move between options (one tab stop for the group), with a lime focus ring.
 */
export function FilterTabs<T extends string>({ label, value, options, onChange, showLabel = true }: { label: string; value: T; options: { value: T; label: React.ReactNode; count?: number }[]; onChange: (v: T) => void; showLabel?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const move = (from: number, by: number) => {
    const i = (from + by + options.length) % options.length
    onChange(options[i].value)
    refs.current[i]?.focus()
  }
  return (
    <div className="flex items-center gap-2">
      {showLabel && <span className="text-[13px] text-muted-foreground">{label}</span>}
      <div className="flex flex-wrap items-center gap-0.5" role="radiogroup" aria-label={label}>
        {options.map((o, i) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
                if (!by) return
                e.preventDefault()
                move(i, by)
              }}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-white/[0.08] font-medium text-foreground" : "text-body hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              {o.label}
              {o.count !== undefined && <CountBadge active={on}>{o.count}</CountBadge>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
