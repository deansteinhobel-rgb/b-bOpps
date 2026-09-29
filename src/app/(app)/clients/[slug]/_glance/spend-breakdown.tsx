"use client"

import Link from "next/link"
import { useState } from "react"
import { PlatformIcon } from "@/components/brand"
import type { AccountNumbers } from "@/lib/account"
import { money, shortDate, whole } from "@/lib/format"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"
import { PLATFORM_COLOR } from "../reporting/charts"
import { cprTone, paceTone, paceWords } from "./tones"

export type PlatformSpend = {
  platform: Platform
  spend: number
  budget: number | null
  /** Where spend should be today if the budget is spread evenly over the month. */
  expected: number | null
  results: number
  cpr: number | null
  /** The same days last month. */
  lastSpend: number | null
  lastCpr: number | null
}

const SHOW = 8

/**
 * Where the money went this month (Dean: spend per platform and per campaign, for anyone to read).
 * One card per platform, which also filters the campaign list under it.
 */
export function SpendBreakdown({ slug, currency, target, platforms, campaigns, total }: { slug: string; currency: string; target: number | null; platforms: PlatformSpend[]; campaigns: AccountNumbers["campaigns"]; total: number }) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [all, setAll] = useState(false)
  const list = campaigns.filter((c) => !platform || c.platform === platform)
  const shown = all ? list : list.slice(0, SHOW)
  const max = Math.max(...list.map((c) => c.spend), 1)

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", platforms.length >= 3 ? "md:grid-cols-3" : platforms.length === 2 ? "md:grid-cols-2" : "")}>
        {platforms.map((p) => {
          const active = platform === p.platform
          const words = paceWords(p.spend, p.expected, p.budget)
          return (
            <button
              key={p.platform}
              type="button"
              onClick={() => {
                setPlatform(active ? null : p.platform)
                setAll(false)
              }}
              aria-pressed={active}
              className={cn("surface space-y-3 p-4 text-left transition-colors hover:border-foreground/25", active && "border-foreground/40")}
              style={active ? { boxShadow: `inset 0 0 0 1px ${PLATFORM_COLOR[p.platform]}` } : undefined}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <PlatformIcon platform={p.platform} />
                  {PLATFORM_LABEL[p.platform]}
                </span>
                <span className="text-xs text-muted-foreground">{total ? `${Math.round((p.spend / total) * 100)}% of spend` : ""}</span>
              </span>
              <span className="block">
                <span className="font-heading text-2xl tabular-nums">{money(p.spend, currency)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{p.budget ? `of ${money(p.budget, currency)}` : "no budget set"}</span>
              </span>
              {p.budget ? (
                <span className="block space-y-1">
                  <span className="relative block h-1.5 overflow-hidden rounded-full bg-secondary">
                    <span className={cn("absolute inset-y-0 left-0 rounded-full", paceTone(p.spend, p.expected, p.budget))} style={{ width: `${Math.min(100, (p.spend / p.budget) * 100)}%` }} />
                    {p.expected !== null && <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(100, (p.expected / p.budget) * 100)}%` }} aria-hidden />}
                  </span>
                  {words && <span className="block text-[11px] text-muted-foreground">{words[0].toUpperCase() + words.slice(1)}</span>}
                </span>
              ) : null}
              <span className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                <span>
                  <span className="block text-muted-foreground">Results</span>
                  <span className="text-sm tabular-nums">{whole(p.results)}</span>
                </span>
                <span>
                  <span className="block text-muted-foreground">Cost per result</span>
                  <span className={cn("text-sm tabular-nums", cprTone(p.cpr, target))}>{p.cpr !== null ? money(p.cpr, currency) : p.spend > 0 ? "No results yet" : "–"}</span>
                  {p.cpr !== null && p.lastCpr !== null && <span className="ml-1 text-[11px] text-muted-foreground">was {money(p.lastCpr, currency)}</span>}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {campaigns.length > 0 && (
        <div className="surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              {platform ? (
                <>
                  {PLATFORM_LABEL[platform]} campaigns ·{" "}
                  <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setPlatform(null)}>
                    show all platforms
                  </button>
                </>
              ) : (
                "Every campaign this month, biggest spend first. Pick a platform above to narrow it down."
              )}
            </span>
            <span className="hidden sm:inline">Spend · cost per result</span>
          </div>
          <ul className="divide-y">
            {shown.map((c) => (
              <li key={`${c.platform}|${c.campaignId}`}>
                <Link href={`/clients/${slug}/reporting/${c.platform}/${encodeURIComponent(c.campaignId)}`} className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] items-center gap-4 px-4 py-2.5 text-sm hover:bg-secondary/30 sm:grid-cols-[minmax(0,1fr)_10rem_6.5rem_6.5rem]">
                  <span className="flex min-w-0 items-center gap-2">
                    <PlatformIcon platform={c.platform} />
                    <span className="min-w-0">
                      <span className="block truncate" title={c.name}>
                        {c.name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {whole(c.results)} result{Math.round(c.results) === 1 ? "" : "s"} · last spend {c.lastDate ? shortDate(c.lastDate) : "–"}
                      </span>
                    </span>
                  </span>
                  <span className="hidden h-1.5 overflow-hidden rounded-full bg-secondary sm:block" aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${(c.spend / max) * 100}%`, backgroundColor: PLATFORM_COLOR[c.platform] }} />
                  </span>
                  <span className="text-right tabular-nums">
                    {money(c.spend, currency)}
                    <span className="block text-[11px] text-muted-foreground">{total ? `${Math.round((c.spend / total) * 100)}% of all` : ""}</span>
                  </span>
                  <span className={cn("text-right tabular-nums", cprTone(c.cpr, target))}>
                    {c.cpr !== null ? money(c.cpr, currency) : "No results"}
                    <span className="block text-[11px] text-muted-foreground">per result</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {list.length > SHOW && (
            <button type="button" onClick={() => setAll(!all)} className="w-full border-t px-4 py-2.5 text-sm text-muted-foreground hover:bg-secondary/40 hover:text-foreground">
              {all ? "Show fewer" : `Show all ${list.length} campaigns`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
