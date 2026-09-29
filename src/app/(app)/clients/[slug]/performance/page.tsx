import { notFound } from "next/navigation"
import { cachedPerformance } from "@/lib/metrics/cached"
import { METRIC, type MetricKey } from "@/lib/metrics/performance"
import type { Platform } from "@/lib/metrics/types"
import { createClient } from "@/lib/supabase/server"
import { CampaignTable, Delta, fmt, Investigator, PlatformSplit, Sparkline, TrendPanel } from "./charts"
import { Controls, parseDays, parsePlatform } from "./controls"

export const metadata = { title: "Performance" }

const CARDS: MetricKey[] = ["spend", "impressions", "clicks", "ctr", "cpc", "results", "cpr"]

/** The Performance tab: the whole account, then each campaign. Insights come in a later phase. */
export default async function PerformancePage({ params, searchParams }: PageProps<"/clients/[slug]/performance">) {
  const { slug } = await params
  const sp = await searchParams
  const days = parseDays(sp.days)
  const platform = parsePlatform(sp.platform)
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  // Access confirmed above (client loaded through RLS), so the shared cache is safe to use.
  const [perf, all] = await Promise.all([cachedPerformance(client.id, days, platform), platform ? cachedPerformance(client.id, days, null) : null])
  if (!perf) return <p className="text-muted-foreground">No ad data yet. An admin can run a Windsor backfill for this client.</p>
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const base = `/clients/${slug}/performance`
  const query = [days !== 30 && `days=${days}`, platform && `platform=${platform}`].filter(Boolean).join("&")
  const last2 = perf.dataThrough.slice(0, 10)
  const twoDaysAgo = new Date(Date.parse(last2) - 864e5).toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      <Controls base={base} days={days} platform={platform} platforms={(all ?? perf).platforms.map((p) => p.platform as Platform)} from={perf.periods.from} to={perf.periods.to} />

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4 xl:grid-cols-7">
        {CARDS.map((k) => (
          <div key={k} className="bg-card px-4 py-3.5">
            <dt className="text-xs text-muted-foreground">{METRIC[k].label}</dt>
            <dd className="mt-1 font-heading text-2xl leading-none tabular-nums">{fmt(k, perf.now[k], cur)}</dd>
            <div className="mt-2 flex items-end justify-between gap-2">
              <Delta k={k} now={perf.now[k]} before={perf.prev[k]} />
              <Sparkline values={perf.daily.map((d) => d[k])} className="h-6 w-20" />
            </div>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <TrendPanel daily={perf.daily} prevDaily={perf.prevDaily} currency={cur} />
        <div className="space-y-6">
          <Investigator now={perf.now} prev={perf.prev} currency={cur} />
          {!platform && <PlatformSplit platforms={perf.platforms} currency={cur} />}
        </div>
      </div>

      <CampaignTable
        slug={slug}
        currency={cur}
        target={target}
        query={query ? `?${query}` : ""}
        rows={perf.campaigns.map((c) => ({ ...c, live: Boolean(c.lastSpendDate && c.lastSpendDate >= twoDaysAgo) }))}
      />
    </div>
  )
}
