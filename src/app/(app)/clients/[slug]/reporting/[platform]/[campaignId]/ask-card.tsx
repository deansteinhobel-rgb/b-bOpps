"use client"

import { ASK_EVENT } from "@/components/ask-chat"
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
          <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5 text-lime" aria-hidden>
            <path d="M8 0.8c.5 3.6 1.9 5.9 7.2 7.2-5.3 1.3-6.7 3.6-7.2 7.2-.5-3.6-1.9-5.9-7.2-7.2C6.1 6.7 7.5 4.4 8 .8Z" />
          </svg>
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
              s === WEEKLY_READ ? "border-lime/40 bg-lime/10 text-foreground hover:bg-lime/15" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}
