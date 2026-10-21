import type { Db } from "@/lib/supabase/db"
import { Suspense } from "react"
import { SectionLoading } from "@/components/loading"
import { cachedOverview } from "@/lib/metrics/cached"
import type { sprintOf } from "@/lib/sprints/periods"
import { sprintDay } from "@/lib/sprints/periods"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadTimeline } from "@/lib/timeline"
import { AdsPanel } from "./ads-panel"
import { AdsSummary, ChangesSummary, PlansSummary } from "./glance-board"
import { GlanceCard } from "./glance-card"
import { loadAds, loadPlans, recentOf } from "./glance-data"
import { ChangesDetail, PlansDetail } from "./glance-details"

/**
 * At a glance's slower cards in the new layout, each streamed in on its own (Dean, 2026-10-15: "show pages in
 * pieces"): the page shows the month and the tiles straight away, and each card shows a spinner until its data is in.
 * Call only after the client row was read through the user's RLS client.
 */
type Ctx = { supabase: Db; slug: string; client: { id: string; slug: string; name: string; currency: string }; today: string; period: ReturnType<typeof sprintOf>; through: Promise<string | null> }

/** `withAds: false` leaves the Ads card out (the Summary's read already shows the ads, Dean 2026-10-21). */
export function GlanceCards({ withAds = true, ...ctx }: Ctx & { withAds?: boolean }) {
  return (
    <>
      {withAds && (
        <Suspense fallback={<SectionLoading label="Loading ads…" className="min-h-56" lines={4} />}>
          <AdsCard {...ctx} />
        </Suspense>
      )}
      <Suspense fallback={<SectionLoading label="Loading what's changed…" className="min-h-56" lines={4} />}>
        <ChangesCard {...ctx} />
      </Suspense>
      <Suspense fallback={<SectionLoading label="Loading the sprint…" className="min-h-56" lines={4} />}>
        <PlansCard {...ctx} />
      </Suspense>
    </>
  )
}

async function AdsCard({ supabase, slug, client, through }: Ctx) {
  const [t, overview] = await Promise.all([through, cachedOverview(client.id)]) // live ads: this morning's snapshot
  if (!t) return null
  const ads = await loadAds(supabase, client.id, t, overview?.liveAds ?? [])
  return (
    <GlanceCard
      id="ads"
      title="Ads"
      meta="last 30 days"
      detailDescription="Which ads are doing the work, and which have run long enough that people are tuning them out."
      summary={<AdsSummary best={ads.best} tiring={ads.tiring} previews={ads.previews} currency={client.currency} />}
      detail={<AdsPanel slug={slug} currency={client.currency} best={ads.best} tiring={ads.tiring} unknown={ads.unknown} previews={ads.previews} />}
    />
  )
}

async function ChangesCard({ supabase, client, today }: Ctx) {
  const since = new Date(Date.parse(today) - 60 * 864e5).toISOString()
  const timeline = await loadTimeline(supabase, createAdminClient(), client, since) // admin only reads the Notion write log, after the RLS check
  const { recent, by } = recentOf(timeline, today)
  return (
    <GlanceCard
      id="changes"
      title="What's changed"
      meta="last 7 days"
      detailDescription="Everything done to the account in the last 60 days: changes the team logged, what Google Ads and Meta recorded, what we can see on LinkedIn, and what was done in this app."
      summary={<ChangesSummary recent={recent.slice(0, 4)} count={recent.length} by={by} />}
      detail={<ChangesDetail timeline={timeline} recent={recent} by={by} />}
    />
  )
}

async function PlansCard({ supabase, slug, client, today, period }: Ctx) {
  const plans = await loadPlans(supabase, client.id, period)
  return (
    <GlanceCard
      id="plans"
      title="What's planned"
      meta={`Sprint ${period.number}`}
      detailDescription="We work in two-week sprints. Each sprint runs a few tests (a new audience, ad or bid approach) and keeps what works."
      summary={<PlansSummary sprint={{ number: period.number, day: sprintDay(period, today), start: period.start, end: period.end }} tests={plans.now} nextCount={plans.nextTests.length} />}
      detail={<PlansDetail slug={slug} period={period} today={today} plans={plans} />}
    />
  )
}
