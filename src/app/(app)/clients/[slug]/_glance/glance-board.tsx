import { AdThumb } from "@/components/ad-thumb"
import { PlatformIcon } from "@/components/brand"
import { Hint } from "@/components/hint"
import type { AccountNumbers } from "@/lib/account"
import { money, percent, shortDate, whole } from "@/lib/format"
import type { FatiguedAd, topAds } from "@/lib/metrics/ads"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { adKey, type PreviewMap } from "@/lib/previews"
import { SPRINT_DAYS } from "@/lib/sprints/periods"
import { STAGES, type Stage } from "@/lib/sprints/tests"
import type { TimelineEntry } from "@/lib/timeline"
import { cn } from "@/lib/utils"
import { GlanceCard } from "./glance-card"
import { GoalCard, type GoalView } from "./goal-card"
import type { PlatformSpend } from "./spend-breakdown"
import { cprTone, paceTone, paceWords } from "./tones"

type Test = { id: string; title: string; platform: string | null; stage: Stage; owner_name: string | null; deadline: string | null; live_on: string | null; outcome: string | null }

/**
 * At a glance in the new layout (Dean, 2026-09-30: less scrolling, click in for more): the month in
 * one line and a row of tiles, then four cards (money, ads, changes, plans) that fit on one screen.
 * Each card shows its headline numbers; the full section opens in a side panel.
 */
export function GlanceBoard(p: {
  slug: string
  name: string
  currency: string
  target: number | null
  numbers: AccountNumbers | null
  month: string | null
  budget: number
  expected: number
  goals: GoalView[]
  canEditGoals: boolean
  platforms: PlatformSpend[]
  best: ReturnType<typeof topAds>
  tiring: FatiguedAd[]
  previews: PreviewMap
  recent: TimelineEntry[]
  recentCount: number
  recentBy: { team: number; platform: number; app: number }
  sprint: { number: number; day: number; start: string; end: string }
  tests: Test[]
  nextCount: number
  headline: React.ReactNode
  details: { spend: React.ReactNode; ads: React.ReactNode; changes: React.ReactNode; plans: React.ReactNode }
}) {
  const cur = p.currency
  const n = p.numbers
  const cols = p.goals.length === 0 ? "lg:grid-cols-3" : p.goals.length === 1 ? "lg:grid-cols-4" : "lg:grid-cols-5"

  return (
    <div className="space-y-5">
      {/* The month in one line, then the numbers that matter */}
      <section className="space-y-4">
        {n ? (
          <div className="space-y-1.5">
            <p className="eyebrow">
              {p.month} so far · to {shortDate(n.dataThrough)}, day {n.daysElapsed} of {n.daysInMonth}
            </p>
            {p.headline}
          </div>
        ) : (
          <p className="surface px-5 py-6 text-sm text-muted-foreground">No ad data yet. Once an ad account is connected and synced, this month&apos;s numbers show here.</p>
        )}
        {(n || p.goals.length > 0) && (
          <div className={cn("grid gap-3 sm:grid-cols-2", cols)}>
            {n && (
              <>
                <Tile label="Spent" hint="What we've paid the ad platforms this month, against the month's budget." value={money(n.mtd.spend, cur)}>
                  {p.budget > 0 ? (
                    <span className="block space-y-1.5">
                      <PaceBar spend={n.mtd.spend} expected={p.expected} budget={p.budget} />
                      <span className="block">
                        of {money(p.budget, cur)} · {paceWords(n.mtd.spend, p.expected, p.budget)}
                      </span>
                    </span>
                  ) : (
                    "No budget set"
                  )}
                </Tile>
                <Tile label="Results" hint="A result is a conversion or a lead: someone filling in a form, booking a demo or signing up after seeing an ad." value={whole(n.mtd.results)}>
                  <Delta now={n.mtd.results} before={n.lastMonthSameDays.results} betterUp /> vs the same days last month ({whole(n.lastMonthSameDays.results)})
                </Tile>
                <Tile label="Cost per result" hint="Spend divided by results: what each result cost us. Lower is better." value={money(n.mtd.cpr, cur)} valueClass={cprTone(n.mtd.cpr, p.target)}>
                  {p.target ? (
                    <span className={cprTone(n.mtd.cpr, p.target)}>
                      {n.mtd.cpr === null ? `Target ${money(p.target, cur)}` : n.mtd.cpr <= p.target ? `Under the ${money(p.target, cur)} target` : `${Math.round((n.mtd.cpr / p.target - 1) * 100)}% over the ${money(p.target, cur)} target`}
                    </span>
                  ) : (
                    "No target set"
                  )}
                </Tile>
              </>
            )}
            {p.goals.map((g) => (
              <GlanceCard key={g.id} id={`goal-${g.id}`} title={g.name} meta={g.monthLabel} summary={<GoalSummary goal={g} />} detailTitle={g.name} detailDescription="The client's main goal this month, from outside the ad platforms. Updated by hand." detail={<GoalCard slug={p.slug} goal={g} canEdit={p.canEditGoals} />} wide={false} />
            ))}
          </div>
        )}
      </section>

      {/* Four cards, one screen: click any for the full picture */}
      <div className="grid gap-3 lg:grid-cols-2">
        {p.details.spend && n && (
          <GlanceCard
            id="spend"
            title="Where the money went"
            meta={`${p.month} so far`}
            detailDescription={`${p.month} so far, by platform and by campaign. Colors compare cost per result with the ${money(p.target, cur)} target: green under it, amber up to 20% over, red further.`}
            summary={<SpendSummary platforms={p.platforms} currency={cur} target={p.target} />}
            detail={p.details.spend}
          />
        )}
        {p.details.ads && (
          <GlanceCard id="ads" title="Ads" meta="last 30 days" detailDescription="Which ads are doing the work, and which have run long enough that people are tuning them out." summary={<AdsSummary best={p.best} tiring={p.tiring} previews={p.previews} currency={cur} />} detail={p.details.ads} />
        )}
        <GlanceCard
          id="changes"
          title="What's changed"
          meta="last 7 days"
          detailDescription="Everything done to the account in the last 60 days: changes the team logged, what Google Ads and Meta recorded, what we can see on LinkedIn, and what was done in this app."
          summary={<ChangesSummary recent={p.recent} count={p.recentCount} by={p.recentBy} />}
          detail={p.details.changes}
        />
        <GlanceCard
          id="plans"
          title="What's planned"
          meta={`Sprint ${p.sprint.number}`}
          detailDescription="We work in two-week sprints. Each sprint runs a few tests (a new audience, ad or bid approach) and keeps what works."
          summary={<PlansSummary sprint={p.sprint} tests={p.tests} nextCount={p.nextCount} />}
          detail={p.details.plans}
        />
      </div>
    </div>
  )
}

function Tile({ label, hint, value, valueClass, children }: { label: string; hint: string; value: string; valueClass?: string; children: React.ReactNode }) {
  return (
    <div className="surface px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        <Hint>{hint}</Hint>
      </p>
      <p className={cn("mt-1.5 font-heading text-3xl leading-none tabular-nums", valueClass)}>{value}</p>
      <div className="mt-2 text-xs text-muted-foreground">{children}</div>
    </div>
  )
}

function PaceBar({ spend, expected, budget }: { spend: number; expected: number; budget: number }) {
  return (
    <span className="relative block h-1.5 overflow-hidden rounded-full bg-secondary">
      <span className={cn("absolute inset-y-0 left-0 rounded-full", paceTone(spend, expected, budget))} style={{ width: `${Math.min(100, (spend / budget) * 100)}%` }} />
      <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(100, (expected / budget) * 100)}%` }} aria-hidden />
    </span>
  )
}

function Delta({ now, before, betterUp = false }: { now: number | null; before: number | null; betterUp?: boolean }) {
  const pct = now === null || before === null || before === 0 ? null : (now / before - 1) * 100
  if (pct === null) return <span>–</span>
  const good = betterUp ? pct > 0 : pct < 0
  return <span className={cn("tabular-nums", Math.abs(pct) < 1 ? "" : good ? "text-rag-green" : "text-rag-red")}>{`${pct > 0 ? "+" : ""}${Math.round(pct)}%`}</span>
}

function GoalSummary({ goal: g }: { goal: GoalView }) {
  const v = g.value ?? 0
  const t = g.target
  const expected = t ? (t * g.dayOfMonth) / g.daysInMonth : null
  const gap = expected !== null ? v - expected : null
  const key = !t || g.value === null ? "none" : v >= t || (gap !== null && gap >= -0.05 * t) ? "good" : gap !== null && gap >= -0.15 * t ? "near" : "off"
  const tone = { good: "text-rag-green", near: "text-rag-amber", off: "text-rag-red", none: "text-muted-foreground" }[key]
  const bar = { good: "bg-rag-green", near: "bg-rag-amber", off: "bg-rag-red", none: "bg-muted-foreground" }[key]
  return (
    <span className="block space-y-2">
      <span className="flex items-baseline gap-1.5">
        <span className={cn("font-heading text-3xl leading-none tabular-nums", tone)}>{g.value === null ? "–" : whole(g.value)}</span>
        {t !== null && <span className="text-xs text-muted-foreground">of {whole(t)}</span>}
      </span>
      {t ? (
        <>
          <span className="relative block h-1.5 overflow-hidden rounded-full bg-secondary">
            <span className={cn("absolute inset-y-0 left-0 rounded-full", bar)} style={{ width: `${Math.min(100, (v / t) * 100)}%` }} />
            {expected !== null && <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(100, (expected / t) * 100)}%` }} aria-hidden />}
          </span>
          <span className="block text-xs text-muted-foreground">{g.value === null ? "Not updated yet this month" : gap !== null && gap >= 0 ? `Ahead of pace by ${whole(gap)}` : `Behind pace by ${whole(Math.abs(gap ?? 0))}`}</span>
        </>
      ) : (
        <span className="block text-xs text-muted-foreground">No target set</span>
      )}
    </span>
  )
}

function SpendSummary({ platforms, currency, target }: { platforms: PlatformSpend[]; currency: string; target: number | null }) {
  return (
    <span className="block">
      <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 text-sm">
        {platforms.slice(0, 4).map((x) => (
          <span key={x.platform} className="contents">
            <span className="flex items-center gap-2">
              <PlatformIcon platform={x.platform} />
              <span className="w-20 truncate text-muted-foreground">{PLATFORM_LABEL[x.platform]}</span>
            </span>
            <span className="block min-w-0 space-y-1">
              <span className="flex items-baseline justify-between gap-2 text-xs">
                <span className="tabular-nums">{money(x.spend, currency)}</span>
                <span className="truncate text-muted-foreground">{x.budget ? `of ${money(x.budget, currency)}` : "no budget"}</span>
              </span>
              {x.budget ? <PaceBar spend={x.spend} expected={x.expected ?? 0} budget={x.budget} /> : <span className="block h-1.5 rounded-full bg-secondary" />}
            </span>
            <span className="text-right text-xs leading-tight">
              <span className={cn("block tabular-nums", cprTone(x.cpr, target))}>{x.cpr === null ? "–" : money(x.cpr, currency)}</span>
              <span className="block text-[10px] text-muted-foreground">{whole(x.results)} results</span>
            </span>
          </span>
        ))}
      </span>
      {platforms.length > 4 && <span className="mt-2 block text-xs text-muted-foreground">+{platforms.length - 4} more</span>}
    </span>
  )
}

function AdsSummary({ best, tiring, previews, currency }: { best: ReturnType<typeof topAds>; tiring: FatiguedAd[]; previews: PreviewMap; currency: string }) {
  // The best ad on each platform first, then the runners-up, three in all.
  const round = (i: number) => best.flatMap((b) => (b.ads[i] ? [{ ad: b.ads[i], basis: b.basis }] : []))
  const top = [...round(0), ...round(1), ...round(2)].slice(0, 3)
  return (
    <span className="block space-y-3">
      <span className="block">
        <span className="block text-xs text-muted-foreground">Working well</span>
        {top.length === 0 ? (
          <span className="mt-1.5 block text-sm text-muted-foreground">Not enough ad data yet.</span>
        ) : (
          <span className="mt-1.5 block space-y-2">
            {top.map(({ ad, basis }) => (
              <span key={adKey(ad)} className="flex items-center gap-3">
                <AdThumb preview={previews[adKey(ad)]} alt={ad.ad_name ?? ad.ad_id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm">
                    <PlatformIcon platform={ad.platform} className="size-3.5" />
                    <span className="truncate">{ad.ad_name ?? ad.ad_id}</span>
                  </span>
                  <span className="block text-xs text-rag-green tabular-nums">{basis === "cost_per_result" ? `${money(ad.costPerResult, currency)} per result` : `${percent(ad.ctr, 2)} clicked`}</span>
                </span>
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2 border-t pt-2.5 text-sm">
        <span className={cn("size-2 shrink-0 rounded-full", tiring.length ? "bg-rag-amber" : "bg-rag-green")} aria-hidden />
        {tiring.length ? (
          <span className="min-w-0 truncate">
            <span className="font-medium">{tiring.length} to refresh</span>
            <span className="text-muted-foreground">: {tiring.slice(0, 2).map((a) => a.ad_name ?? a.ad_id).join(", ")}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">No live ads look tired.</span>
        )}
      </span>
    </span>
  )
}

function ChangesSummary({ recent, count, by }: { recent: TimelineEntry[]; count: number; by: { team: number; platform: number; app: number } }) {
  return (
    <span className="block space-y-3">
      <span className="flex items-baseline gap-2">
        <span className="font-heading text-3xl leading-none tabular-nums">{count}</span>
        <span className="text-xs text-muted-foreground">{count === 0 ? "changes. Nothing changed in the last 7 days." : [by.team && `${by.team} by the team`, by.platform && `${by.platform} on the platforms`, by.app && `${by.app} in the app`].filter(Boolean).join(" · ")}</span>
      </span>
      {recent.length > 0 && (
        <span className="block divide-y divide-border/60">
          {recent.map((e) => (
            <span key={e.id} className="flex items-center gap-2 py-1.5 text-sm first:pt-0">
              <span className="w-12 shrink-0 text-[11px] text-muted-foreground tabular-nums">{shortDate(e.at.slice(0, 10))}</span>
              <PlatformIcon platform={e.platform} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              {e.who && <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{e.who.split(" ")[0]}</span>}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

function PlansSummary({ sprint, tests, nextCount }: { sprint: { number: number; day: number; start: string; end: string }; tests: Test[]; nextCount: number }) {
  const counts = STAGES.map((s) => ({ ...s, n: tests.filter((t) => t.stage === s.key).length })).filter((s) => s.n > 0)
  return (
    <span className="block space-y-3">
      <span className="block space-y-1.5">
        <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {shortDate(sprint.start)} – {shortDate(sprint.end)}
          </span>
          <span>
            Day {sprint.day} of {SPRINT_DAYS}
          </span>
        </span>
        <span className="block h-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
          <span className="block h-full rounded-full bg-foreground/50" style={{ width: `${(sprint.day / SPRINT_DAYS) * 100}%` }} />
        </span>
      </span>
      {tests.length === 0 ? (
        <span className="block text-sm text-muted-foreground">Nothing planned yet for this sprint.</span>
      ) : (
        <>
          <span className="flex flex-wrap gap-1.5">
            {counts.map((s) => (
              <StagePill key={s.key} stage={s.key} label={`${s.n} ${s.label.toLowerCase()}`} />
            ))}
          </span>
          <span className="block space-y-1.5">
            {tests.slice(0, 3).map((t) => (
              <span key={t.id} className="flex items-center gap-2 text-sm">
                <PlatformIcon platform={(t.platform as Platform) ?? null} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
              </span>
            ))}
            {tests.length > 3 && <span className="block text-xs text-muted-foreground">+{tests.length - 3} more</span>}
          </span>
        </>
      )}
      <span className="block border-t pt-2.5 text-xs text-muted-foreground">Next sprint: {nextCount ? `${nextCount} test${nextCount === 1 ? "" : "s"} planned` : "nothing planned yet"}</span>
    </span>
  )
}

const STAGE_TONE: Record<string, string> = {
  live: "border-rag-green/40 bg-rag-green/10 text-rag-green",
  review: "border-violet/40 bg-violet/10 text-violet",
  done: "border-foreground/15 text-muted-foreground",
}
/** A test's stage as a small pill (At a glance, both layouts). */
export function StagePill({ stage, label }: { stage: string; label?: string }) {
  const s = STAGES.find((x) => x.key === stage)
  return <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px]", STAGE_TONE[stage] ?? "border-foreground/15 text-foreground/80")}>{label ?? s?.label ?? stage}</span>
}
