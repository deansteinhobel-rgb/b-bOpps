"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { saveGoalValue } from "./goal-actions"

export type GoalView = {
  id: string
  name: string
  month: string // YYYY-MM-01
  monthLabel: string
  value: number | null
  target: number | null
  lastMonthLabel: string
  lastMonth: number | null
  dayOfMonth: number
  daysInMonth: number
  updated: string | null // "29 Sept by Dean Steinhobel"
}

const fmt = (v: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(v)

/**
 * A client's main business goal this month as a ring (Dean: DNSFilter's Activated Free Trials,
 * target 300): how much of the target is done, where it should be by today, last month beside it.
 * Admins and GTM leads update the figure as the month goes on.
 */
export function GoalCard({ slug, goal, canEdit }: { slug: string; goal: GoalView; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(goal.value === null ? "" : String(goal.value))
  const [target, setTarget] = useState(goal.target === null ? "" : String(goal.target))
  const [pending, start] = useTransition()
  const [hover, setHover] = useState<"done" | "left" | "pace" | null>(null)

  const v = goal.value ?? 0
  const t = goal.target
  const share = t ? Math.min(1, v / t) : 0
  const expected = t ? (t * goal.dayOfMonth) / goal.daysInMonth : null
  const projected = goal.dayOfMonth > 0 ? (v / goal.dayOfMonth) * goal.daysInMonth : null
  const gap = expected !== null ? v - expected : null
  const vsLast = goal.lastMonth ? (v / goal.lastMonth - 1) * 100 : null
  const tone = !t || goal.value === null ? "none" : v >= t ? "good" : gap !== null && gap >= -0.05 * t ? "good" : gap !== null && gap >= -0.15 * t ? "near" : "off"
  const TONE = { good: "text-rag-green", near: "text-rag-amber", off: "text-rag-red", none: "text-muted-foreground" } as const

  // Ring geometry: 0° at the top, clockwise.
  const R = 52
  const C = 2 * Math.PI * R
  const doneLen = share * C
  const paceAngle = t && expected !== null ? Math.min(1, expected / t) * 2 * Math.PI - Math.PI / 2 : null

  const save = () =>
    start(async () => {
      const n = Number(value)
      const tg = target === "" ? null : Number(target)
      if (!Number.isFinite(n) || (tg !== null && !Number.isFinite(tg))) return void toast.error("Enter a number.")
      const r = await saveGoalValue(slug, { goalId: goal.id, month: goal.month, value: n, target: tg })
      if (!r.ok) return void toast.error(r.message ?? "Couldn't save.")
      toast.success("Updated.")
      setEditing(false)
    })

  const tip = hover === "done" ? `${fmt(v)} ${goal.name.toLowerCase()} so far (${t ? Math.round((v / t) * 100) : 0}% of target)` : hover === "left" ? `${t ? fmt(Math.max(0, t - v)) : "–"} still to go to reach ${t ? fmt(t) : "the target"}` : hover === "pace" && expected !== null ? `On pace would be ${fmt(Math.round(expected))} by today (day ${goal.dayOfMonth} of ${goal.daysInMonth})` : null

  return (
    <section className="surface relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-lime/[0.06] blur-3xl" />
      <div className="relative flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-6">
        {/* The ring */}
        <div className="relative mx-auto size-40 shrink-0 sm:mx-0" onMouseLeave={() => setHover(null)}>
          <svg viewBox="0 0 128 128" className="size-full -rotate-90" role="img" aria-label={`${goal.name}: ${fmt(v)} of ${t ? fmt(t) : "no target"} this month`}>
            <circle cx="64" cy="64" r={R} fill="none" stroke="currentColor" strokeWidth="12" className="text-secondary" onMouseEnter={() => setHover("left")} />
            {doneLen > 0 && (
              <circle
                cx="64"
                cy="64"
                r={R}
                fill="none"
                stroke="var(--lime)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(doneLen - 2, 0.01)} ${C}`}
                className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
                onMouseEnter={() => setHover("done")}
              />
            )}
          </svg>
          {/* Where "on pace" would be today */}
          {paceAngle !== null && (
            <span
              className="absolute h-4 w-0.5 rounded-full bg-foreground"
              style={{ left: `calc(50% + ${Math.cos(paceAngle) * (R / 128) * 100}% - 1px)`, top: `calc(50% + ${Math.sin(paceAngle) * (R / 128) * 100}% - 8px)`, transform: `rotate(${(paceAngle + Math.PI / 2) * (180 / Math.PI)}deg)` }}
              onMouseEnter={() => setHover("pace")}
              aria-hidden
            />
          )}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-heading text-4xl leading-none tabular-nums">{goal.value === null ? "–" : fmt(v)}</span>
            <span className="mt-1 text-xs text-muted-foreground tabular-nums">of {t ? fmt(t) : "–"}</span>
          </div>
          {tip && <span className="absolute top-full left-1/2 z-10 mt-1 w-56 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-center text-xs shadow-lg">{tip}</span>}
        </div>

        {/* The numbers */}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-lime uppercase">Main goal · {goal.monthLabel}</p>
            <h3 className="mt-1 text-xl font-semibold">{goal.name}</h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Stat label="Of target" value={t && goal.value !== null ? `${Math.round((v / t) * 100)}%` : "–"} className={TONE[tone]} />
            <Stat label="Pace today" value={gap === null || goal.value === null ? "–" : gap >= 0 ? `${fmt(Math.round(gap))} ahead` : `${fmt(Math.round(-gap))} behind`} className={TONE[tone]} />
            <Stat label="On course for" value={projected === null || goal.value === null ? "–" : fmt(Math.round(projected))} />
            <Stat
              label={`${goal.lastMonthLabel}`}
              value={goal.lastMonth === null ? "–" : fmt(goal.lastMonth)}
              hint={vsLast === null || goal.value === null ? undefined : <span className={vsLast >= 0 ? "text-rag-green" : "text-rag-red"}>{`${vsLast >= 0 ? "+" : ""}${Math.round(vsLast)}% this month`}</span>}
            />
          </dl>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-lime" aria-hidden /> So far
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-secondary ring-1 ring-border" aria-hidden /> Still to go
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0.5 rounded-full bg-foreground" aria-hidden /> Where on pace would be today
            </span>
            {goal.updated && <span className="ml-auto">Updated {goal.updated}</span>}
          </div>

          {canEdit &&
            (editing ? (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-background/50 p-3">
                <label className="text-xs text-muted-foreground">
                  {goal.monthLabel} so far
                  <Input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 h-8 w-28" onKeyDown={(e) => e.key === "Enter" && save()} />
                </label>
                <label className="text-xs text-muted-foreground">
                  Target
                  <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 h-8 w-24" onKeyDown={(e) => e.key === "Enter" && save()} />
                </label>
                <Button size="sm" disabled={pending} onClick={save}>
                  {pending ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Update {goal.monthLabel}&apos;s figure
              </Button>
            ))}
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value, hint, className }: { label: string; value: string; hint?: React.ReactNode; className?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-medium tabular-nums", className)}>{value}</dd>
      {hint && <dd className="text-xs">{hint}</dd>}
    </div>
  )
}
