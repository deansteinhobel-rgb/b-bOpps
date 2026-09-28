"use client"

import { useState, useTransition } from "react"
import { fieldClass } from "@/components/admin-form"
import { PlatformIcon, PlatformLabel } from "@/components/brand"
import { Sparkle } from "@/components/fx/sparkle"
import { StatusDot } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { currencySymbol, money } from "@/lib/format"
import type { CampaignPacing, PlatformPacing } from "@/lib/metrics/overview"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"
import { saveMonthBudget } from "./budget-actions"

type Row = {
  key: string
  platform: Platform
  campaignId: string
  label: React.ReactNode
  title: string
  spend: number
  budget: number | null
  status: PlatformPacing["status"]
  ratio: number | null
  expectedShare: number // share of the month elapsed, 0..1
  budgetNote?: string
}

const FILL: Record<PlatformPacing["status"], string> = { green: "bg-rag-green", amber: "bg-rag-amber", red: "bg-rag-red", no_budget: "bg-rag-na" }

/**
 * Budget pacing as sliders: spend against the month's budget, with a marker for where spend should
 * be today. Switch between platforms and campaigns; admins can edit this month's budgets.
 */
export function PacingPanel(props: { platforms: PlatformPacing[]; campaigns: CampaignPacing[]; currency: string; month: string; canEdit: boolean; clientSlug: string }) {
  const [mode, setMode] = useState<"platform" | "campaign">("platform")
  const [filter, setFilter] = useState<Platform | "all">("all")
  const [showAll, setShowAll] = useState(false)
  const monthDate = new Date(props.month)
  const monthLabel = Number.isNaN(monthDate.getTime()) ? "this month" : new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(monthDate)
  const share = (p: { daysElapsed: number; daysInMonth: number }) => p.daysElapsed / p.daysInMonth

  const platformRows: Row[] = props.platforms.map((p) => ({
    key: p.platform,
    platform: p.platform,
    campaignId: "",
    label: <PlatformLabel platform={p.platform} />,
    title: PLATFORM_LABEL[p.platform],
    spend: p.spendMtd,
    budget: p.budget,
    status: p.status,
    ratio: p.ratio,
    expectedShare: share(p),
    budgetNote: p.budgetSource === "month" ? `${monthLabel} budget` : p.budgetSource === "default" ? "Default monthly budget" : undefined,
  }))
  const campaignRows: Row[] = (props.campaigns ?? [])
    .filter((c) => filter === "all" || c.platform === filter)
    .map((c) => ({
      key: `${c.platform}|${c.campaignId}`,
      platform: c.platform,
      campaignId: c.campaignId,
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <PlatformIcon platform={c.platform} />
          <span className="truncate">{c.campaignName}</span>
        </span>
      ),
      title: c.campaignName,
      spend: c.spendMtd,
      budget: c.budget,
      status: c.status,
      ratio: c.ratio,
      expectedShare: share(c),
    }))
  const rows = mode === "platform" ? platformRows : showAll ? campaignRows : campaignRows.slice(0, 12)
  const platformsHere = [...new Set((props.campaigns ?? []).map((c) => c.platform))]

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <select aria-label="Show pacing by" className={cn(fieldClass, "h-8 w-40")} value={mode} onChange={(e) => setMode(e.target.value as "platform" | "campaign")}>
            <option value="platform">By platform</option>
            <option value="campaign">By campaign</option>
          </select>
          {mode === "campaign" && (
            <div className="flex flex-wrap gap-1">
              {(["all", ...platformsHere] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFilter(p)}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs", filter === p ? "border-foreground/25 bg-accent" : "text-muted-foreground hover:text-foreground")}
                >
                  {p === "all" ? "All" : <PlatformLabel platform={p} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-px bg-foreground/60" /> where spend should be today
          </span>
        </p>
      </div>

      <ul className="divide-y">
        {rows.map((r) => (
          <PacingRow key={r.key} row={r} currency={props.currency} canEdit={props.canEdit} clientSlug={props.clientSlug} month={props.month} monthLabel={monthLabel} />
        ))}
        {rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No campaigns with spend this month.</li>}
      </ul>
      {mode === "campaign" && campaignRows.length > 12 && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="w-full border-t px-4 py-2.5 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground">
          {showAll ? "Show fewer" : `Show all ${campaignRows.length} campaigns`}
        </button>
      )}
    </div>
  )
}

function PacingRow({ row: r, currency, canEdit, clientSlug, month, monthLabel }: { row: Row; currency: string; canEdit: boolean; clientSlug: string; month: string; monthLabel: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(r.budget ? String(Math.round(r.budget)) : "")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // The slider's scale runs to 130% of budget so overspend stays visible.
  const scale = 1.3
  const spentShare = r.budget ? r.spend / r.budget : 0
  const fillPct = Math.min(spentShare / scale, 1) * 100
  const budgetPct = 100 / scale
  const todayPct = (r.expectedShare / scale) * 100
  const save = () =>
    start(async () => {
      const res = await saveMonthBudget({ clientSlug, platform: r.platform, campaignId: r.campaignId, month, amount: Number(value) })
      if (res.ok) {
        setEditing(false)
        setError(null)
      } else setError(res.message ?? "Couldn't save.")
    })

  return (
    <li className="px-4 py-3.5">
      <div className="grid items-center gap-3 md:grid-cols-[minmax(0,15rem)_1fr_13rem]">
        <div className="min-w-0 text-sm" title={r.title}>
          {r.label}
          {r.budgetNote && <p className="mt-0.5 text-[11px] text-subtle-foreground">{r.budgetNote}</p>}
        </div>

        {r.budget ? (
          <div
            className="relative h-2.5 rounded-full bg-secondary"
            role="meter"
            aria-label={`${r.title}: ${Math.round(spentShare * 100)}% of budget spent`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(spentShare * 100)}
          >
            <div className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", FILL[r.status])} style={{ width: `${fillPct}%` }} />
            {/* 100% of budget */}
            <div className="absolute -inset-y-1 w-px bg-foreground/25" style={{ left: `${budgetPct}%` }} />
            {/* Where spend should be today */}
            <div className="absolute -inset-y-1.5 w-0.5 rounded bg-foreground/80" style={{ left: `${todayPct}%` }} title="Where spend should be today" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No budget set for {monthLabel}</p>
        )}

        <div className="flex items-center justify-between gap-3 md:justify-end">
          <div className="text-right text-sm tabular-nums">
            <p>
              {money(r.spend, currency)} <span className="text-muted-foreground">/ {r.budget ? money(r.budget, currency) : "–"}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">{r.ratio === null ? "Spend this month" : `${Math.round(r.ratio * 100)}% of pace`}</p>
          </div>
          {r.status !== "no_budget" && <StatusDot status={r.status} className="size-2.5" />}
          {canEdit && (
            <button type="button" onClick={() => setEditing((e) => !e)} className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              {r.budget ? "Edit" : "Set"}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-background/60 p-3 md:ml-[15rem]">
          <label htmlFor={`b-${r.key}`} className="text-xs text-muted-foreground">
            {monthLabel} budget ({currencySymbol(currency)})
          </label>
          <Input id={`b-${r.key}`} type="number" min="0" step="100" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-36" />
          <Sparkle>
            <Button size="sm" disabled={pending || value === ""} onClick={save}>
              {pending ? "Saving…" : "Save budget"}
            </Button>
          </Sparkle>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {error && <span className="text-xs text-rag-red">{error}</span>}
        </div>
      )}
    </li>
  )
}
