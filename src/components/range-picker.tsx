"use client"

import { Check } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { dayText as fmt, PRESET_LABEL, PRESETS, rangeText, type Periods, type RangeSpec } from "@/lib/metrics/range"
import { cn } from "@/lib/utils"


/**
 * The date range button and its panel (Dean, 2026-09-30): calendar presets on the left, custom
 * from / to dates on the right. Used by the Reporting toolbar and by the Notion embeds, so whoever
 * views a report can change the range. Dates are limited to the data we have.
 */
export function RangePicker({ range, periods, dataFrom, dataThrough, onChange, align = "end", compact = false }: { range: RangeSpec; periods: Pick<Periods, "from" | "to" | "prevFrom" | "prevTo" | "compare">; dataFrom: string; dataThrough: string; onChange: (r: RangeSpec) => void; align?: "start" | "end"; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(periods.from)
  const [to, setTo] = useState(periods.to)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const toggle = () => {
    if (!open) {
      setFrom(periods.from)
      setTo(periods.to)
    }
    setOpen(!open)
  }
  const pick = (r: RangeSpec) => {
    setOpen(false)
    onChange(r)
  }
  const valid = Boolean(from && to && from <= to && from >= dataFrom && to <= dataThrough)

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary", open && "bg-secondary")}
        title="Change the date range"
      >
        <CalendarIcon />
        {range.kind === "preset" && <span className="font-medium text-foreground">{PRESET_LABEL[range.preset]}</span>}
        <span className="tabular-nums text-foreground">{rangeText(periods.from, periods.to, dataThrough)}</span>
        {!compact && <span className="hidden text-muted-foreground md:inline">{periods.compare ? `vs ${rangeText(periods.prevFrom, periods.prevTo, dataThrough)}` : "no comparison"}</span>}
        <svg viewBox="0 0 12 12" className="size-3 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div id={id} role="dialog" aria-label="Date range" className={cn("absolute top-full z-50 mt-1.5 flex w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-popover text-sm shadow-xl sm:flex-row", align === "end" ? "right-0" : "left-0")}>
          <ul className="grid grid-cols-2 gap-0.5 border-b p-1.5 sm:w-44 sm:grid-cols-1 sm:border-r sm:border-b-0">
            {PRESETS.map((p) => {
              const active = range.kind === "preset" && range.preset === p
              return (
                <li key={p}>
                  <button type="button" onClick={() => pick({ kind: "preset", preset: p })} className={cn("flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary", active ? "text-foreground" : "text-muted-foreground")}>
                    {PRESET_LABEL[p]}
                    {active && <Check className="size-3.5 text-lime" aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>
          <form
            className="flex flex-1 flex-col gap-3 p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (valid) pick({ kind: "custom", from, to })
            }}
          >
            <p className="text-xs font-medium">Custom dates</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                From
                <input type="date" value={from} min={dataFrom} max={to || dataThrough} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground tabular-nums" required />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                To
                <input type="date" value={to} min={from || dataFrom} max={dataThrough} onChange={(e) => setTo(e.target.value)} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground tabular-nums" required />
              </label>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Data from {fmt(dataFrom, true)} to {fmt(dataThrough, true)}. Compared with the same number of days before.
            </p>
            <Button type="submit" size="sm" disabled={!valid} className="mt-auto self-end">
              Apply
            </Button>
          </form>
        </div>
      )}
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
