"use client"

import { usePathname, useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Segmented } from "@/components/segmented"
import { cn } from "@/lib/utils"

const PERIODS = [7, 14, 30, 90] as const

/** The embed's period (Dean: whoever views the embed can change the date range). Kept in the URL. */
export function PeriodPicker({ days }: { days: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const [view, setView] = useState(days)
  const [seen, setSeen] = useState(days)
  if (seen !== days) {
    setSeen(days)
    setView(days)
  }
  return (
    <div className={cn("transition-opacity", pending && "opacity-60")}>
      <Segmented
        label="Period"
        value={String(view)}
        options={PERIODS.map((d) => ({ value: String(d), label: `Last ${d} days` }))}
        onChange={(v) => {
          setView(Number(v))
          start(() => router.replace(`${pathname}?days=${v}`, { scroll: false }))
        }}
      />
    </div>
  )
}
