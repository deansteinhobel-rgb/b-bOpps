"use client"

import Link from "next/link"
import { useState } from "react"
import { PlatformIcon } from "@/components/brand"
import { FilterChip } from "@/components/segmented"
import type { AccountNumbers } from "@/lib/account"
import { money, shortDate } from "@/lib/format"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"
import { PLATFORM_COLOR } from "../performance/charts"

/** This month's spend per campaign, biggest first, with its share of the month and cost per result. */
export function CampaignSpend({ slug, currency, target, campaigns, total }: { slug: string; currency: string; target: number | null; campaigns: AccountNumbers["campaigns"]; total: number }) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [all, setAll] = useState(false)
  const platforms = (["google_ads", "linkedin", "meta"] as Platform[]).filter((p) => campaigns.some((c) => c.platform === p))
  const list = campaigns.filter((c) => !platform || c.platform === platform)
  const shown = all ? list : list.slice(0, 12)
  const max = Math.max(...list.map((c) => c.spend), 1)
  return (
    <div className="surface overflow-hidden">
      {platforms.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b p-3" role="radiogroup" aria-label="Platform">
          <FilterChip active={!platform} onClick={() => setPlatform(null)}>
            All · {money(total, currency)}
          </FilterChip>
          {platforms.map((p) => (
            <FilterChip key={p} active={platform === p} color={PLATFORM_COLOR[p]} onClick={() => setPlatform(platform === p ? null : p)}>
              <PlatformIcon platform={p} className="size-3.5" />
              {PLATFORM_LABEL[p]} · {money(campaigns.filter((c) => c.platform === p).reduce((s, c) => s + c.spend, 0), currency)}
            </FilterChip>
          ))}
        </div>
      )}
      <ul className="divide-y">
        {shown.map((c) => (
          <li key={`${c.platform}|${c.campaignId}`}>
            <Link href={`/clients/${slug}/performance/${c.platform}/${encodeURIComponent(c.campaignId)}`} className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-4 px-4 py-2.5 text-sm hover:bg-secondary/30 sm:grid-cols-[minmax(0,1fr)_12rem_7rem_6rem]">
              <span className="flex min-w-0 items-center gap-2">
                <PlatformIcon platform={c.platform} />
                <span className="min-w-0">
                  <span className="block truncate" title={c.name}>
                    {c.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">Last spend {c.lastDate ? shortDate(c.lastDate) : "–"}</span>
                </span>
              </span>
              <span className="hidden h-1.5 overflow-hidden rounded-full bg-secondary sm:block" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${(c.spend / max) * 100}%`, backgroundColor: PLATFORM_COLOR[c.platform] }} />
              </span>
              <span className="text-right tabular-nums">
                {money(c.spend, currency)}
                <span className="block text-[11px] text-muted-foreground">{total ? `${Math.round((c.spend / total) * 100)}%` : ""}</span>
              </span>
              <span className={cn("text-right tabular-nums", target && c.cpr !== null ? (c.cpr <= target ? "text-rag-green" : c.cpr <= target * 1.2 ? "text-rag-amber" : "text-rag-red") : "text-muted-foreground")}>
                {c.cpr !== null ? money(c.cpr, currency) : c.results ? "–" : "no results"}
                <span className="block text-[11px] text-muted-foreground">per result</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {list.length > 12 && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-t px-4 py-2.5 text-sm text-muted-foreground hover:bg-secondary/40 hover:text-foreground">
          {all ? "Show fewer" : `Show all ${list.length} campaigns`}
        </button>
      )}
    </div>
  )
}
