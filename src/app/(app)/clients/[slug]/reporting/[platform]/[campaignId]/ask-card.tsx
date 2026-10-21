"use client"

import { ASK_EVENT } from "@/components/ask-chat"
import { ClaudeMark } from "@/components/brand"
import { CAMPAIGN_STARTERS, WEEKLY_READ } from "@/lib/insights/campaign-starters"
import { cn } from "@/lib/utils"

/**
 * The new layout's "Ask about this campaign": the starter questions, opening the one Ask panel (bottom
 * right) on this campaign instead of a second chat on the page.
 */
export function CampaignAskCard({ aiReady }: { aiReady: boolean }) {
  const open = (question?: string) => window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { mode: "campaign", question } }))
  return (
    <section className="surface flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ClaudeMark className="size-3.5 text-lime" />
          Ask about this campaign
        </h3>
        <p className="text-xs text-muted-foreground">Opens Ask on this campaign: 12 weeks of numbers, the ads, open insights, its goal and the client brief.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {CAMPAIGN_STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={!aiReady}
            onClick={() => open(s)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50",
              s === WEEKLY_READ ? "border-border-strong bg-elevated text-foreground hover:border-foreground/30" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}
