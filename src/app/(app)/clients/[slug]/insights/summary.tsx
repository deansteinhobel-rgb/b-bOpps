import Link from "next/link"
import { PlatformIcon } from "@/components/brand"
import { money } from "@/lib/format"
import { loadFeed } from "@/lib/insights/feed"
import { isOpportunity, RULES, type FeedInsight } from "@/lib/insights/rules"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

const DOT = { high: "bg-rag-red", medium: "bg-rag-amber", low: "bg-muted-foreground/50" } as const

/** A short list of open insights (the campaign drill-down, the Performance tab), each linking into the feed. */
export function InsightSummary({ slug, insights, currency, limit = 5, title = "Optimise now" }: { slug: string; insights: FeedInsight[]; currency: string; limit?: number; title?: string }) {
  const open = insights.filter((i) => i.state === "open").sort((a, b) => Number(isOpportunity(b)) - Number(isOpportunity(a)))
  if (!open.length) return null
  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">
          {title} <span className="ml-1 text-xs font-normal text-muted-foreground">{open.length}</span>
        </h3>
        <Link href={`/clients/${slug}/insights`} className="text-xs text-muted-foreground hover:text-foreground">
          See all →
        </Link>
      </div>
      <ul className="divide-y">
        {open.slice(0, limit).map((i) => (
          <li key={i.key}>
            <Link href={`/clients/${slug}/insights?i=${encodeURIComponent(i.key)}`} className={cn("flex items-start gap-3 border-l-2 border-transparent px-4 py-2.5 text-sm hover:bg-secondary/40", isOpportunity(i) && "border-l-lime")}>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", isOpportunity(i) ? "bg-lime" : DOT[i.severity])} title={isOpportunity(i) ? "Opportunity" : `${i.severity} priority`} />
              {i.platform !== "ga4" && <PlatformIcon platform={i.platform} className="mt-0.5" />}
              <span className="min-w-0 flex-1">
                <span className="block leading-snug">{i.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{RULES[i.rule].label}</span>
              </span>
              {(i.atStake ?? 0) > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{money(i.atStake, currency)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Loads the feed itself, so a page can stream it in a Suspense boundary without waiting.
 * SECURITY: only render after the page loaded the client through RLS (loadFeed reads the cache).
 */
export async function LoadedInsightSummary({ slug, clientId, currency, platform, campaignId, title }: { slug: string; clientId: string; currency: string; platform?: string | null; campaignId?: string | null; title?: string }) {
  const feed = await loadFeed(await createClient(), clientId)
  if (!feed) return null
  const list = feed.insights.filter((i) => (!platform || i.platform === platform) && (!campaignId || i.campaignId === campaignId))
  return <InsightSummary slug={slug} insights={list} currency={currency} title={title} />
}
