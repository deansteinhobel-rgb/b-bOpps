"use client"

import { usePathname, useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { RangePicker } from "@/components/range-picker"
import { Segmented } from "@/components/segmented"
import { QUICK_DAYS, rangeParams, sameRange, type Periods, type RangeSpec } from "@/lib/metrics/range"
import { cn } from "@/lib/utils"

/**
 * The embed's dates (Dean: whoever views the embed can change the date range): the quick periods
 * plus the date range picker with presets and custom dates. Kept in the URL, always explicit, so it
 * never falls back to the link's default by accident.
 */
export function PeriodPicker({ range, periods, dataFrom, dataThrough }: { range: RangeSpec; periods: Periods; dataFrom: string; dataThrough: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const [view, setView] = useState(range)
  const [seen, setSeen] = useState(range)
  if (!sameRange(seen, range)) {
    setSeen(range)
    setView(range)
  }
  const go = (r: RangeSpec) => {
    if (sameRange(r, view)) return
    setView(r)
    start(() => router.replace(`${pathname}?${rangeParams(r, new URLSearchParams(), 0)}`, { scroll: false }))
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <Segmented label="Period" value={view.kind === "days" ? String(view.days) : ""} options={QUICK_DAYS.map((d) => ({ value: String(d), label: `${d}d`, title: `Last ${d} days` }))} onChange={(v) => go({ kind: "days", days: Number(v) })} />
      <RangePicker range={view} periods={periods} dataFrom={dataFrom} dataThrough={dataThrough} onChange={go} align="start" />
    </div>
  )
}
