import { notFound } from "next/navigation"
import { AdThumb, ViewAdLink } from "@/components/ad-thumb"
import { PlatformIcon, PlatformLabel } from "@/components/brand"
import { SectionHeader } from "@/components/page-header"
import { getProfile, isAdmin } from "@/lib/auth"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { longDate, money, shortDate, oneDp, percent, signedPct, whole } from "@/lib/format"
import type { RankedAd } from "@/lib/metrics/ads"
import { AD_OLD_DAYS, pctChange } from "@/lib/metrics/ads"
import { cachedOverview } from "@/lib/metrics/cached"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { adKey, previewsFor, type PreviewMap } from "@/lib/previews"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { FatiguePanel } from "./fatigue-panel"
import { PacingPanel } from "./pacing-panel"

export default async function OverviewPage({ params }: PageProps<"/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  const me = await getProfile()
  const { data: client } = await supabase.from("clients").select("id, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const o = await cachedOverview(client.id) // access confirmed above (client loaded through RLS)
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)

  if (!o) return <p className="text-muted-foreground">No ad data yet. An admin can run a Windsor backfill for this client.</p>
  const newest = o.newCreatives.slice(0, 12)
  const previews = await previewsFor(supabase, client.id, [
    ...o.rankings.flatMap((r) => [r.best, r.worst]).filter((a) => a !== null),
    ...o.liveAds,
    ...newest,
  ])

  return (
    <div className="space-y-10">
      <p className="eyebrow">
        Data through {longDate(o.dataThrough)} · Windsor syncs daily, so figures are up to a day old
      </p>

      {/* Pacing */}
      <section className="space-y-4">
        <SectionHeader
          title="Budget pacing"
          description="Spend this month against budget. Amber outside ±10% of pace; red over 20% above, or no spend for the last 2 days."
        />
        <PacingPanel platforms={o.pacing} campaigns={o.campaignPacing} currency={cur} month={o.month} canEdit={isAdmin(me)} clientSlug={slug} />
      </section>

      {/* Performance */}
      <section>
        <h2 className="text-2xl">Spend and cost per result</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Result = conversions + leads. Target: {money(target, cur)} per result.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(
            [
              ["Last 7 days", o.periods.last7, o.periods.prev7],
              ["Last 30 days", o.periods.last30, o.periods.prev30],
            ] as const
          ).map(([label, now, prev]) => (
            <Card key={label}>
              <CardHeader>
                <CardTitle className="eyebrow">{label} vs previous</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-4 text-sm">
                <Metric label="Spend" value={money(now.spend, cur)} change={pctChange(now.spend, prev.spend)} />
                <Metric label="Results" value={oneDp(now.results)} change={pctChange(now.results, prev.results)} />
                <Metric
                  label="Cost per result"
                  value={money(now.costPerResult, cur)}
                  change={pctChange(now.costPerResult, prev.costPerResult)}
                  lowerIsBetter
                  status={target && now.costPerResult !== null ? (now.costPerResult <= target ? "green" : now.costPerResult <= target * 1.2 ? "amber" : "red") : undefined}
                />
              </CardContent>
            </Card>
          ))}
        </div>
        <Table className="surface mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Platform</TableHead>
              <TableHead className="text-right">Spend 7d</TableHead>
              <TableHead className="text-right">Results 7d</TableHead>
              <TableHead className="text-right">Cost/result 7d</TableHead>
              <TableHead className="text-right">Spend 30d</TableHead>
              <TableHead className="text-right">Results 30d</TableHead>
              <TableHead className="text-right">Cost/result 30d</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {o.byPlatform.map((p) => (
              <TableRow key={p.platform}>
                <TableCell><PlatformLabel platform={p.platform} /></TableCell>
                <TableCell className="text-right tabular-nums">{money(p.last7.spend, cur)}</TableCell>
                <TableCell className="text-right tabular-nums">{oneDp(p.last7.results)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(p.last7.costPerResult, cur)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(p.last30.spend, cur)}</TableCell>
                <TableCell className="text-right tabular-nums">{oneDp(p.last30.results)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(p.last30.costPerResult, cur)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {/* Best / worst */}
      <section>
        <h2 className="text-2xl">Best and worst ad, last 7 days</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only ads above their account&apos;s median spend. Ranked by cost per result when at least two have 3+ results, otherwise by CTR.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {o.rankings.map((r) => (
            <Card key={r.platform}>
              <CardHeader>
                <CardTitle className="text-sm font-medium"><PlatformLabel platform={r.platform} /></CardTitle>
                <p className="text-xs text-muted-foreground">
                  By {r.basis === "cost_per_result" ? "cost per result" : "CTR"} · {r.eligible} eligible ad{r.eligible === 1 ? "" : "s"}
                </p>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <AdLine label="Best" ad={r.best} basis={r.basis} currency={cur} previews={previews} />
                <AdLine label="Worst" ad={r.worst} basis={r.basis} currency={cur} previews={previews} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Fatigue */}
      <section className="space-y-4">
        <SectionHeader
          title="Ad fatigue"
          description={`Every live ad: its first 14 days against its last 14 days. First seen is red when it's over ${AD_OLD_DAYS} days ago; the last 14 days are red when worse. Age counts from the first day with impressions in our data (from ${longDate(o.dataFrom)}), because Windsor can't see creative edits.`}
        />
        <FatiguePanel ads={o.liveAds} previews={previews} currency={cur} />
      </section>

      {/* New creatives */}
      <section>
        <h2 className="text-2xl">New creatives this month</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ads first seen in {o.dataThrough.slice(0, 7)}.</p>
        <p className="mt-4 text-sm">
          {o.newCreatives.length === 0
            ? "None yet."
            : (["linkedin", "google_ads", "meta"] as const)
                .map((p) => [p, o.newCreatives.filter((a) => a.platform === p)] as const)
                .filter(([, list]) => list.length > 0)
                .map(([p, list]) => `${PLATFORM_LABEL[p]}: ${list.length} (${list.filter((a) => a.live).length} still live)`)
                .join(" · ")}
        </p>
        {newest.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {newest.map((a) => (
              <li key={adKey(a)} className="group/card surface overflow-hidden transition-colors hover:border-foreground/20">
                <AdThumb preview={previews[adKey(a)]} alt={a.ad_name ?? a.ad_id} size="card" className="rounded-none border-0 border-b" />
                <div className="space-y-1.5 p-3">
                  <p className="line-clamp-2 min-h-[2lh] text-xs font-medium leading-snug" title={a.ad_name ?? a.ad_id}>
                    {a.ad_name ?? a.ad_id}
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <PlatformIcon platform={a.platform} className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate">First seen {shortDate(a.first_seen)}</span>
                    <span className={cn("size-1.5 shrink-0 rounded-full", a.live ? "bg-rag-green" : "bg-rag-na")} title={a.live ? "Live" : "Not live"} aria-label={a.live ? "Live" : "Not live"} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Metric({ label, value, change, lowerIsBetter, status }: { label: string; value: string; change: number | null; lowerIsBetter?: boolean; status?: "green" | "amber" | "red" }) {
  const good = change === null ? null : lowerIsBetter ? change < 0 : change > 0
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-2xl tabular-nums">{value}</p>
      <p className={good === null ? "text-xs text-muted-foreground" : good ? "text-xs text-rag-green" : "text-xs text-rag-red"}>{signedPct(change)}</p>
      {status && <StatusBadge status={status} label={status === "green" ? "On target" : status === "amber" ? "Near target" : "Over target"} className="mt-1" />}
    </div>
  )
}

function AdLine({ label, ad, basis, currency, previews }: { label: string; ad: RankedAd | null; basis: "cost_per_result" | "ctr"; currency: string; previews: PreviewMap }) {
  if (!ad) return <p className="text-muted-foreground">{label}: not enough eligible ads</p>
  const preview = previews[adKey(ad)]
  return (
    <div className="flex gap-3">
      <AdThumb preview={preview} alt={ad.ad_name ?? ad.ad_id} />
      <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="line-clamp-2 font-bold" title={ad.ad_name ?? ad.ad_id}>{ad.ad_name ?? ad.ad_id}</p>
      <p className="line-clamp-1 text-xs text-muted-foreground">{ad.campaign_name}</p>
      <p className="mt-1 tabular-nums">
        {basis === "cost_per_result" ? `${money(ad.costPerResult, currency)} per result` : `${percent(ad.ctr, 2)} CTR`} · {money(ad.spend, currency)} spend ·{" "}
        {oneDp(ad.results)} results · {whole(ad.clicks)} clicks
      </p>
      <ViewAdLink preview={preview} />
      </div>
    </div>
  )
}
