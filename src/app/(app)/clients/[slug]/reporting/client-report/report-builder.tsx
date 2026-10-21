"use client"

import { Check, Search } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { PlatformIcon } from "@/components/brand"
import { RangePicker } from "@/components/range-picker"
import { Segmented } from "@/components/segmented"
import { Input } from "@/components/ui/input"
import { compactMoney, whole } from "@/lib/format"
import { QUICK_DAYS, rangeLabel, rangeParams, type Periods, type RangeSpec } from "@/lib/metrics/range"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"
import type { CampaignOption } from "./data"

type Step = "platform" | "campaign" | "dates"

/**
 * The questions before the client report (Dean, 2026-10-19): which platform, which campaign (all
 * of them first), which dates. Each answer goes in the URL, so the report renders on the server and
 * a link to the page opens on the same report. An answered question folds into one line with Change.
 */
export function ReportBuilder({
  platform,
  campaign,
  campaignName,
  range,
  periods,
  dataFrom,
  dataThrough,
  platforms,
  campaigns,
  currency,
}: {
  platform: Platform | "all" | null
  campaign: string | null
  campaignName: string | null
  range: RangeSpec
  periods: Periods
  dataFrom: string
  dataThrough: string
  platforms: { platform: Platform; spend: number }[]
  campaigns: CampaignOption[]
  currency: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<Step | null>(null)
  const [query, setQuery] = useState("")
  const open: Step | null = editing ?? (!platform ? "platform" : !campaign ? "campaign" : null)

  const go = (next: { platform?: string | null; campaign?: string | null; range?: RangeSpec }) => {
    const q = rangeParams(next.range ?? range, new URLSearchParams())
    const p = next.platform !== undefined ? next.platform : platform
    const c = next.campaign !== undefined ? next.campaign : campaign
    if (p) q.set("platform", p)
    if (c) q.set("campaign", c)
    setEditing(null)
    setQuery("")
    start(() => router.replace(`${pathname}?${q}`, { scroll: false }))
  }

  const platformText = platform === "all" ? "All platforms" : platform ? PLATFORM_LABEL[platform] : null
  const campaignText = campaign === "all" ? "All campaigns" : campaign ? (campaignName ?? "One campaign") : null
  const shown = campaigns.filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className={cn("surface divide-y transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <Question n={1} title="Which platform?" answer={platformText} icon={platform && platform !== "all" ? platform : null} open={open === "platform"} onChange={() => setEditing("platform")}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Platform">
          <Choice on={platform === "all"} onClick={() => go({ platform: "all", campaign: null })}>
            All platforms
          </Choice>
          {platforms.map((p) => (
            <Choice key={p.platform} on={platform === p.platform} onClick={() => go({ platform: p.platform, campaign: null })}>
              <PlatformIcon platform={p.platform} className="size-4" />
              {PLATFORM_LABEL[p.platform]}
              <span className="text-xs text-muted-foreground tabular-nums">{compactMoney(p.spend, currency)}</span>
            </Choice>
          ))}
        </div>
        {platforms.length === 0 && <p className="mt-2 text-[13px] text-muted-foreground">No spend in these dates. Try a longer date range below.</p>}
      </Question>

      {platform && (
        <Question n={2} title="Which campaign?" answer={campaignText} open={open === "campaign"} onChange={() => setEditing("campaign")}>
          <div className="space-y-2">
            {campaigns.length > 8 && (
              <label className="relative block max-w-sm">
                <span className="sr-only">Find a campaign</span>
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a campaign" className="h-8 pl-8" />
              </label>
            )}
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border" role="radiogroup" aria-label="Campaign">
              <CampaignRow on={campaign === "all"} onClick={() => go({ campaign: "all" })} name={`All campaigns${campaigns.length ? ` (${campaigns.length})` : ""}`} />
              {shown.map((c) => (
                <CampaignRow key={c.value} on={campaign === c.value} onClick={() => go({ campaign: c.value })} name={c.name} platform={platform === "all" ? c.platform : null} detail={`${compactMoney(c.spend, currency)} · ${whole(c.results)} ${c.results === 1 ? "result" : "results"}`} />
              ))}
              {query && shown.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted-foreground">No campaign matches “{query}”.</li>}
            </ul>
            <p className="text-xs text-muted-foreground">Campaigns that spent in the dates below, biggest first.</p>
          </div>
        </Question>
      )}

      {platform && campaign && (
        <Question n={3} title="Which dates?" answer={rangeLabel(range)} open always>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Period" value={range.kind === "days" ? String(range.days) : ""} options={QUICK_DAYS.map((d) => ({ value: String(d), label: `${d}d`, title: `Last ${d} days` }))} onChange={(v) => go({ range: { kind: "days", days: Number(v) } })} />
            <RangePicker range={range} periods={periods} dataFrom={dataFrom} dataThrough={dataThrough} onChange={(r) => go({ range: r })} align="start" />
          </div>
        </Question>
      )}
    </div>
  )
}

function Question({ n, title, answer, icon, open, always, onChange, children }: { n: number; title: string; answer: string | null; icon?: Platform | null; open: boolean; always?: boolean; onChange?: () => void; children: React.ReactNode }) {
  const done = Boolean(answer) && !open
  return (
    <section className="flex gap-4 px-5 py-4" aria-label={title}>
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums", done || always ? "bg-white/[0.1] text-foreground" : "bg-white text-ink")} aria-hidden>
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {done && (
            <span className="flex min-w-0 items-center gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-body">
                {icon && <PlatformIcon platform={icon} className="size-4 shrink-0" />}
                <span className="truncate">{answer}</span>
              </span>
              {onChange && (
                <button type="button" onClick={onChange} className="shrink-0 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  Change
                </button>
              )}
            </span>
          )}
        </div>
        {(open || always) && <div className="mt-3">{children}</div>}
      </div>
    </section>
  )
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-border-strong bg-white/[0.1] font-medium text-foreground" : "text-body hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function CampaignRow({ on, onClick, name, platform, detail }: { on: boolean; onClick: () => void; name: string; platform?: Platform | null; detail?: string }) {
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={onClick}
        className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors outline-none hover:bg-white/[0.04] focus-visible:bg-white/[0.06]", on && "bg-white/[0.08] font-medium")}
      >
        <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-white bg-white" : "border-border-strong")} aria-hidden>
          {on && <span className="size-1.5 rounded-full bg-black" />}
        </span>
        {platform && <PlatformIcon platform={platform} className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate" title={name}>
          {name}
        </span>
        {detail && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{detail}</span>}
      </button>
    </li>
  )
}
