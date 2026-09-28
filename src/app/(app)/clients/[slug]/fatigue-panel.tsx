"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { AdThumb, ViewAdLink } from "@/components/ad-thumb"
import { PlatformIcon } from "@/components/brand"
import { longDate, money, percent, signedPct, whole } from "@/lib/format"
import { AD_OLD_DAYS, type FatiguedAd } from "@/lib/metrics/ads"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import type { Preview } from "@/lib/previews"
import { cn } from "@/lib/utils"

type Mode = "ctr" | "cpr"
const SHOW = 24
const keyOf = (a: FatiguedAd) => `${a.platform}|${a.external_account_id}|${a.ad_id}`

/**
 * Ad fatigue as compact tiles: platform, ad preview, first seen (red when older than 30 days), and the ad's
 * first 14 days against its last 14 days (red when worse). Toggle CTR or cost per result; click a
 * tile for the detail.
 */
export function FatiguePanel({ ads, previews, currency }: { ads: FatiguedAd[]; previews: Record<string, Preview | undefined>; currency: string }) {
  const [mode, setMode] = useState<Mode>("ctr")
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const worse = (a: FatiguedAd) => (mode === "ctr" ? a.ctrDown : a.cprUp)
  // Ads needing attention first (worse and old), then by spend in the last 14 days.
  const sorted = [...ads].sort((a, b) => Number(worse(b)) + Number(b.old) - (Number(worse(a)) + Number(a.old)) || b.recent_spend - a.recent_spend)
  const shown = showAll ? sorted : sorted.slice(0, SHOW)
  const flagged = ads.filter((a) => a.old && worse(a)).length

  if (ads.length === 0) return <p className="text-sm text-muted-foreground">No live ads.</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Compare by" className="inline-flex rounded-lg border bg-card p-0.5 text-xs">
          {(
            [
              ["ctr", "CTR"],
              ["cpr", "Cost per conversion / lead"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded-md px-3 py-1.5 transition-colors", mode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {ads.length} live ads · <span className={flagged ? "text-rag-red" : undefined}>{flagged}</span> over {AD_OLD_DAYS} days old and {mode === "ctr" ? "CTR down" : "cost per result up"}
        </p>
      </div>

      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((a) => {
          const k = keyOf(a)
          return <Tile key={k} ad={a} mode={mode} preview={previews[k]} currency={currency} open={open === k} onToggle={() => setOpen(open === k ? null : k)} />
        })}
      </ul>
      {sorted.length > SHOW && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="w-full rounded-lg border px-4 py-2 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground">
          {showAll ? "Show fewer" : `Show all ${sorted.length} live ads`}
        </button>
      )}
    </div>
  )
}

function Tile({ ad: a, mode, preview, currency, open, onToggle }: { ad: FatiguedAd; mode: Mode; preview?: Preview; currency: string; open: boolean; onToggle: () => void }) {
  const name = a.ad_name ?? a.ad_id
  const first = mode === "ctr" ? percent(a.earlyCtr, 2) : money(a.earlyCpr, currency)
  const last = mode === "ctr" ? percent(a.recentCtr, 2) : a.recentCpr === null && a.recent_spend > 0 ? "No results" : money(a.recentCpr, currency)
  const worse = mode === "ctr" ? a.ctrDown : a.cprUp
  const firstSeen = `${longDate(a.first_seen)}${a.firstSeenCapped ? " or earlier" : ""}`

  return (
    <li className={cn("surface overflow-hidden transition-colors", open ? "col-span-full border-foreground/20" : "hover:border-foreground/20")}>
      {/* The preview sits outside the toggle button: it has its own hover card and Meta link. */}
      <div className="flex items-center gap-3 p-3">
        <PlatformIcon platform={a.platform} className="size-4 shrink-0 self-start" />
        <AdThumb preview={preview} alt={name} size="md" />
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${name}: ${open ? "hide" : "show"} details`} title={name} className="flex min-w-0 flex-1 items-start gap-2 self-stretch text-left">
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block text-xs text-muted-foreground">
              First seen <span className={cn("block tabular-nums", a.old ? "text-rag-red" : "text-foreground")}>{firstSeen}</span>
            </span>
            <span className="grid grid-cols-2 gap-2 text-xs">
              <span>
                <span className="block text-[11px] text-muted-foreground">First 14 days</span>
                <span className="tabular-nums">{a.comparable ? first : "–"}</span>
              </span>
              <span>
                <span className="block text-[11px] text-muted-foreground">Last 14 days</span>
                <span className={cn("tabular-nums", worse && "text-rag-red")}>{last}</span>
              </span>
            </span>
          </span>
          <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>

      {open && (
        <div className="grid gap-4 border-t p-4 md:grid-cols-[auto_1fr]">
          <div className="space-y-2">
            <AdThumb preview={preview} alt={name} size="lg" />
            <ViewAdLink preview={preview} />
          </div>
          <div className="min-w-0 space-y-3">
            <div className="text-sm">
              <p className="font-medium">{name}</p>
              <p className="text-xs text-muted-foreground">
                {PLATFORM_LABEL[a.platform]} · {a.campaign_name ?? "No campaign"} · {a.firstSeenCapped ? `${a.ageDays}+` : a.ageDays} days live
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-xs tabular-nums">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 text-left font-normal" />
                    <th className="py-1.5 text-right font-normal">Impressions</th>
                    <th className="py-1.5 text-right font-normal">Clicks</th>
                    <th className="py-1.5 text-right font-normal">CTR</th>
                    <th className="py-1.5 text-right font-normal">Spend</th>
                    <th className="py-1.5 text-right font-normal">Results</th>
                    <th className="py-1.5 text-right font-normal">Cost per result</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-1.5 text-muted-foreground">First 14 days</td>
                    {a.firstSeenCapped ? (
                      <td colSpan={6} className="py-1.5 text-right text-muted-foreground">
                        Before our data starts
                      </td>
                    ) : (
                      <>
                        <td className="py-1.5 text-right">{whole(a.early_impressions)}</td>
                        <td className="py-1.5 text-right">{whole(a.early_clicks)}</td>
                        <td className="py-1.5 text-right">{percent(a.earlyCtr, 2)}</td>
                        <td className="py-1.5 text-right">{money(a.early_spend, currency)}</td>
                        <td className="py-1.5 text-right">{whole(a.early_conversions + a.early_leads)}</td>
                        <td className="py-1.5 text-right">{money(a.earlyCpr, currency)}</td>
                      </>
                    )}
                  </tr>
                  <tr className="border-b">
                    <td className="py-1.5 text-muted-foreground">Last 14 days</td>
                    <td className="py-1.5 text-right">{whole(a.recent_impressions)}</td>
                    <td className="py-1.5 text-right">{whole(a.recent_clicks)}</td>
                    <td className={cn("py-1.5 text-right", a.ctrDown && "text-rag-red")}>{percent(a.recentCtr, 2)}</td>
                    <td className="py-1.5 text-right">{money(a.recent_spend, currency)}</td>
                    <td className="py-1.5 text-right">{whole(a.recent_conversions + a.recent_leads)}</td>
                    <td className={cn("py-1.5 text-right", a.cprUp && "text-rag-red")}>{money(a.recentCpr, currency)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-muted-foreground">Change</td>
                    <td colSpan={2} />
                    <td className={cn("py-1.5 text-right", a.ctrDown && "text-rag-red")}>{signedPct(a.ctrChangePct)}</td>
                    <td colSpan={2} />
                    <td className={cn("py-1.5 text-right", a.cprUp && "text-rag-red")}>{signedPct(a.cprChangePct)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!a.comparable && (
              <p className="text-[11px] text-subtle-foreground">
                {a.firstSeenCapped
                  ? "This ad was already running when our data starts, so its first 14 days aren't available."
                  : "Less than 28 days live, so the first and last 14 days overlap. No comparison yet."}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
