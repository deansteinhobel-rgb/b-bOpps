import { notFound } from "next/navigation"
import { AdThumb, ViewAdLink } from "@/components/ad-thumb"
import { PlatformLabel } from "@/components/brand"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { longDate, money, oneDp, percent, signedPct, whole } from "@/lib/format"
import type { RankedAd } from "@/lib/metrics/ads"
import { pctChange } from "@/lib/metrics/ads"
import { cachedOverview } from "@/lib/metrics/cached"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { adKey, previewsFor, type PreviewMap } from "@/lib/previews"
import { createClient } from "@/lib/supabase/server"

export default async function OverviewPage({ params }: PageProps<"/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const o = await cachedOverview(client.id) // access confirmed above (client loaded through RLS)
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)

  if (!o) return <p className="text-muted-foreground">No ad data yet. An admin can run a Windsor backfill for this client.</p>
  const newest = o.newCreatives.slice(0, 12)
  const previews = await previewsFor(supabase, client.id, [
    ...o.rankings.flatMap((r) => [r.best, r.worst]).filter((a) => a !== null),
    ...o.fatigued.slice(0, 20),
    ...newest,
  ])

  return (
    <div className="space-y-10">
      <p className="eyebrow">
        Data through {longDate(o.dataThrough)} · Windsor syncs daily, so figures are up to a day old
      </p>

      {/* Pacing */}
      <section>
        <h2 className="text-2xl">Budget pacing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Spend this month against budget × days elapsed. Amber outside ±10%; red over 20% above, or no spend for the last 2 days.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {o.pacing.map((p) => (
            <Card key={p.platform}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium"><PlatformLabel platform={p.platform} /></CardTitle>
                <StatusBadge status={p.status} />
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-heading text-3xl">{p.ratio === null ? "–" : `${Math.round(p.ratio * 100)}%`}</p>
                <p className="text-muted-foreground">of expected spend by day {p.daysElapsed} of {p.daysInMonth}</p>
                <dl className="mt-3 grid grid-cols-2 gap-y-1">
                  <dt className="text-muted-foreground">Spent</dt>
                  <dd className="text-right tabular-nums">{money(p.spendMtd, cur)}</dd>
                  <dt className="text-muted-foreground">Expected</dt>
                  <dd className="text-right tabular-nums">{p.budget ? money(p.expected, cur) : "–"}</dd>
                  <dt className="text-muted-foreground">Monthly budget</dt>
                  <dd className="text-right tabular-nums">{money(p.budget, cur)}</dd>
                </dl>
                {p.reasons.length > 0 && <p className="pt-2 text-xs text-muted-foreground">{p.reasons.join(" · ")}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
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
      <section>
        <h2 className="text-2xl">Ad fatigue</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live ads first seen 45 or more days ago. Windsor can&apos;t see creative edits, so age is counted from the first day an ad had impressions in our data
          (which starts {longDate(o.dataFrom)}). &ldquo;{longDate(o.dataFrom)} or earlier&rdquo; means it may be older.
        </p>
        {o.fatigued.length === 0 ? (
          <p className="mt-4 text-sm">No fatigued ads.</p>
        ) : (
          <Table className="surface mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>First seen</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="text-right">Spend 7d</TableHead>
                <TableHead className="text-right">CTR 7d</TableHead>
                <TableHead className="text-right">CTR first 14d</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.fatigued.slice(0, 20).map((a) => (
                <TableRow key={`${a.platform}-${a.ad_id}`}>
                  <TableCell className="max-w-80">
                    <div className="flex items-center gap-3">
                      <AdThumb preview={previews[adKey(a)]} alt={a.ad_name ?? a.ad_id} size="sm" />
                      <div className="min-w-0">
                        <span className="line-clamp-1" title={a.ad_name ?? a.ad_id}>{a.ad_name ?? a.ad_id}</span>
                        <span className="line-clamp-1 text-xs text-muted-foreground">{a.campaign_name}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><PlatformLabel platform={a.platform} className="text-muted-foreground" /></TableCell>
                  <TableCell>{a.firstSeenCapped ? `${longDate(a.first_seen)} or earlier` : longDate(a.first_seen)}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.firstSeenCapped ? `${a.ageDays}+` : a.ageDays} days</TableCell>
                  <TableCell className="text-right tabular-nums">{money(a.recent_spend, cur)}</TableCell>
                  <TableCell className="text-right tabular-nums">{percent(a.recentCtr, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.firstSeenCapped ? "–" : percent(a.earlyCtr, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.firstSeenCapped ? "–" : signedPct(a.ctrChangePct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {o.fatigued.length > 20 && <p className="mt-2 text-xs text-muted-foreground">Showing the 20 biggest spenders of {o.fatigued.length}.</p>}
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
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {newest.map((a) => (
              <li key={adKey(a)} className="space-y-1 text-xs">
                <AdThumb preview={previews[adKey(a)]} alt={a.ad_name ?? a.ad_id} size="lg" className="w-full" />
                <p className="line-clamp-2" title={a.ad_name ?? a.ad_id}>{a.ad_name ?? a.ad_id}</p>
                <p className="text-muted-foreground">
                  {PLATFORM_LABEL[a.platform]} · first seen {longDate(a.first_seen)}
                </p>
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
