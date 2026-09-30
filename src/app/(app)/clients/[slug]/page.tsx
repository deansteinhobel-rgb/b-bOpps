import Link from "next/link"
import { notFound } from "next/navigation"
import { PlatformIcon } from "@/components/brand"
import { Hint } from "@/components/hint"
import { getAccountNumbers } from "@/lib/account"
import { getProfile, isAdmin } from "@/lib/auth"
import { newLayout } from "@/lib/lens"
import { londonToday } from "@/lib/checks/periods"
import { money, shortDate, whole } from "@/lib/format"
import { addDays, tiringAds, topAds, type AdStat } from "@/lib/metrics/ads"
import { cachedOverview, cachedPacing } from "@/lib/metrics/cached"
import type { Platform } from "@/lib/metrics/types"
import { previewsFor } from "@/lib/previews"
import { sprintByNumber, sprintDay, sprintOf, SPRINT_DAYS } from "@/lib/sprints/periods"
import { STAGES, stageOf, type TestStatus } from "@/lib/sprints/tests"
import { createAdminClient } from "@/lib/supabase/admin"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { createClient } from "@/lib/supabase/server"
import { loadTimeline } from "@/lib/timeline"
import { cn } from "@/lib/utils"
import { AdsPanel } from "./_glance/ads-panel"
import { ContentIdeas } from "./_glance/content-ideas"
import { loadContentIdeas } from "./_glance/content-ideas-data"
import { GoalCard, type GoalView } from "./_glance/goal-card"
import { SectionNav } from "@/components/section-nav"
import { SpendBreakdown, type PlatformSpend } from "./_glance/spend-breakdown"
import { GlanceBoard, StagePill } from "./_glance/glance-board"
import { Timeline } from "./_glance/timeline"
import { cprTone, paceTone, paceWords } from "./_glance/tones"

export const metadata = { title: "At a glance" }

const SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "spend", label: "Spend" },
  { id: "ads", label: "Ads" },
  { id: "content", label: "Content ideas" },
  { id: "changes", label: "Changes" },
  { id: "plans", label: "Plans" },
]
const num = (v: unknown) => Number(v ?? 0)
const monthName = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(m))

/**
 * At a glance, the first client tab (Dean, 2026-09-29; was "Account"): how the account is doing, for anyone, with or without a paid
 * media background. It reads top to bottom as a story: how the month is going, where the money went,
 * which ads work and which are tiring, what's been changed, and what's planned.
 */
export default async function AtAGlancePage({ params }: PageProps<"/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, name, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const today = londonToday()
  const period = sprintOf(today)
  const since = new Date(Date.parse(today) - 60 * 864e5).toISOString()

  // The client's main business goals (e.g. DNSFilter's Activated Free Trials), this month and last.
  const month = `${today.slice(0, 7)}-01`
  const lastMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10)
  const [numbers, pacing, overview, { data: sprints }, timeline, { data: goals }, me] = await Promise.all([
    getAccountNumbers(supabase, client.id),
    cachedPacing(client.id), // access confirmed above (client loaded through RLS)
    cachedOverview(client.id), // live ads and their first vs last 14 days
    supabase.from("sprints").select("id, number, start_date, end_date, key_takeaway, closed_at").eq("client_id", client.id).in("start_date", [sprintByNumber(period.number - 1).start, period.start, sprintByNumber(period.number + 1).start]),
    loadTimeline(supabase, createAdminClient(), client, since), // admin only reads the Notion write log, after the RLS check
    supabase.from("client_goals").select("id, name, monthly_target, client_goal_values(month, value, target, updated_at, profiles(full_name, email))").eq("client_id", client.id).eq("active", true).order("position"),
    getProfile(),
  ])
  const goalViews: GoalView[] = (goals ?? []).map((g) => {
    const values = (g.client_goal_values ?? []) as unknown as { month: string; value: number | string; target: number | string | null; updated_at: string; profiles: { full_name: string | null; email: string } | null }[]
    const cur = values.find((x) => x.month === month)
    const prev = values.find((x) => x.month === lastMonth)
    const who = cur?.profiles?.full_name ?? cur?.profiles?.email
    return {
      id: g.id,
      name: g.name,
      month,
      monthLabel: monthName(month),
      value: cur ? Number(cur.value) : null,
      target: cur?.target != null ? Number(cur.target) : g.monthly_target != null ? Number(g.monthly_target) : null,
      lastMonthLabel: monthName(lastMonth),
      lastMonth: prev ? Number(prev.value) : null,
      dayOfMonth: Number(today.slice(8, 10)),
      daysInMonth: new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate(),
      updated: cur ? `${shortDate(cur.updated_at.slice(0, 10))}${who ? ` by ${who}` : ""}` : null,
    }
  })

  // Sprint tests: this sprint, the next and the last.
  const byNumber = new Map((sprints ?? []).map((s) => [s.number as number, s]))
  const current = byNumber.get(period.number)
  const next = byNumber.get(period.number + 1)
  const previous = byNumber.get(period.number - 1)
  const ids = [current?.id, next?.id, previous?.id].filter(Boolean) as string[]

  // Ads: the best over the last 30 days, and the live ones that look tired.
  const through = numbers?.dataThrough ?? overview?.dataThrough
  const [{ data: tests }, adRows] = await Promise.all([
    ids.length ? supabase.from("sprint_tests").select("id, sprint_id, title, platform, status, outcome, owner_name, deadline, live_on").in("sprint_id", ids).order("created_at") : Promise.resolve({ data: [] as never[] }),
    through ? rpcAll(supabase, "ad_totals", { p_client: client.id, p_from: addDays(through, -29), p_to: through }) : Promise.resolve([]),
  ])
  const best = topAds(
    adRows.map(
      (r): AdStat => ({
        platform: r.platform as Platform,
        external_account_id: String(r.external_account_id),
        ad_id: String(r.ad_id),
        ad_name: (r.ad_name as string | null) ?? null,
        campaign_name: (r.campaign_name as string | null) ?? null,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        conversions: num(r.conversions),
        leads: num(r.leads),
      }),
    ),
  )
  const liveAds = overview?.liveAds ?? []
  const tiring = tiringAds(liveAds)
  const previews = await previewsFor(supabase, client.id, [...best.flatMap((p) => p.ads), ...tiring.slice(0, 6)])

  // Content ideas: on this page in the classic layout; the new layout has them under Plan › Content ideas.
  const withIdeas = !newLayout(me.preferences)
  const ideas = withIdeas && through ? await loadContentIdeas(supabase, client, today) : null

  const testsOf = (id?: string) => (tests ?? []).filter((t) => t.sprint_id === id)
  const now = testsOf(current?.id)
    .map((t) => ({ ...t, stage: stageOf({ status: t.status as TestStatus, outcome: t.outcome }, null) }))
    .sort((a, b) => STAGES.findIndex((s) => s.key === a.stage) - STAGES.findIndex((s) => s.key === b.stage))
  const prevTests = testsOf(previous?.id)
  const nextTests = testsOf(next?.id)

  // Budget and pace.
  const pacingBy = new Map((pacing?.pacing ?? []).map((p) => [p.platform, p]))
  const budget = (pacing?.pacing ?? []).reduce((s, p) => s + (p.budget ?? 0), 0)
  const expected = (pacing?.pacing ?? []).reduce((s, p) => s + (p.budget ? p.expected : 0), 0)
  const platforms: PlatformSpend[] = (numbers?.byPlatform ?? [])
    .filter((p) => p.mtd.spend > 0 || pacingBy.get(p.platform)?.budget)
    .map((p) => {
      const pc = pacingBy.get(p.platform)
      return { platform: p.platform, spend: p.mtd.spend, budget: pc?.budget ?? null, expected: pc?.budget ? pc.expected : null, results: p.mtd.results, cpr: p.mtd.cpr, lastSpend: p.lastMonthSameDays.spend || null, lastCpr: p.lastMonthSameDays.cpr }
    })
    .sort((a, b) => b.spend - a.spend)

  // What changed in the last 7 days (bulk tool changes left out, as in the timeline's default).
  const weekAgo = Date.parse(today) - 7 * 864e5
  const recent = timeline.filter((e) => !e.bulk && Date.parse(e.at) >= weekAgo)
  const recentBy = { team: recent.filter((e) => e.source === "team").length, platform: recent.filter((e) => e.source === "platform").length, app: recent.filter((e) => e.source === "app").length }

  // Each section's full content: inline in the classic layout, in a side panel behind a card in the new one.
  const changesDetail = (
    <div className="space-y-4">
      <p className="text-sm">
        {recent.length === 0 ? (
          <span className="text-muted-foreground">Nothing changed in the last 7 days.</span>
        ) : (
          <>
            <span className="font-medium">
              {recent.length} change{recent.length === 1 ? "" : "s"} in the last 7 days
            </span>
            <span className="text-muted-foreground">: {[recentBy.team && `${recentBy.team} logged by the team`, recentBy.platform && `${recentBy.platform} on the platforms`, recentBy.app && `${recentBy.app} in the app`].filter(Boolean).join(", ")}.</span>
          </>
        )}
      </p>
      <Timeline entries={timeline} pageSize={20} />
    </div>
  )
  const plansDetail = (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="surface overflow-hidden">
        <div className="space-y-2 border-b px-5 py-4">
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              This sprint: Sprint {period.number} · {shortDate(period.start)} – {shortDate(period.end)}
            </span>
            <span className="text-xs text-muted-foreground">
              Day {sprintDay(period, today)} of {SPRINT_DAYS}
            </span>
          </p>
          <span className="block h-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
            <span className="block h-full rounded-full bg-foreground/50" style={{ width: `${(sprintDay(period, today) / SPRINT_DAYS) * 100}%` }} />
          </span>
        </div>
        {now.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nothing planned yet for this sprint.</p>
        ) : (
          <ul className="divide-y">
            {now.map((t) => (
              <li key={t.id}>
                <Link href={`/clients/${slug}/sprint#test-${t.id}`} className="flex items-start gap-3 px-5 py-3 text-sm hover:bg-secondary/30">
                  <PlatformIcon platform={(t.platform as Platform) ?? null} className="mt-0.5 size-4" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 leading-snug">{t.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {[t.owner_name, t.outcome ? t.outcome.charAt(0).toUpperCase() + t.outcome.slice(1) : t.live_on ? `live since ${shortDate(t.live_on)}` : t.deadline ? `due ${shortDate(t.deadline)}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <StagePill stage={t.stage} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-4">
        <div className="surface p-5 text-sm">
          <p className="font-medium">Next: Sprint {period.number + 1}</p>
          <p className="text-xs text-muted-foreground">
            Starts {shortDate(sprintByNumber(period.number + 1).start)}
          </p>
          {nextTests.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-4">
              {nextTests.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-muted-foreground">Nothing planned yet. Carried-over tests and new plans appear here.</p>
          )}
        </div>
        {previous && (
          <div className="surface p-5 text-sm">
            <p className="font-medium">Last: Sprint {previous.number}</p>
            <p className="text-xs text-muted-foreground">
              {prevTests.filter((t) => t.outcome === "proven").length} worked · {prevTests.filter((t) => t.outcome === "disproven").length} didn&apos;t · {prevTests.filter((t) => t.outcome === "carried").length} carried over
            </p>
            {previous.key_takeaway && <p className="mt-3">{previous.key_takeaway}</p>}
          </div>
        )}
      </div>
    </div>
  )
  const compact = newLayout(me.preferences)
  if (compact) {
    return (
      <GlanceBoard
        slug={slug}
        name={client.name}
        currency={cur}
        target={target}
        numbers={numbers}
        month={numbers ? monthName(numbers.month) : null}
        budget={budget}
        expected={expected}
        goals={goalViews}
        canEditGoals={isAdmin(me)}
        platforms={platforms}
        best={best}
        tiring={tiring}
        previews={previews}
        recent={recent.slice(0, 4)}
        recentCount={recent.length}
        recentBy={recentBy}
        sprint={{ number: period.number, day: sprintDay(period, today), start: period.start, end: period.end }}
        tests={now}
        nextCount={nextTests.length}
        headline={numbers ? <Headline name={client.name} currency={cur} target={target} budget={budget} expected={expected} month={monthName(numbers.month)} spend={numbers.mtd.spend} results={numbers.mtd.results} cpr={numbers.mtd.cpr} compact /> : null}
        details={{
          spend: numbers && platforms.length > 0 ? <SpendBreakdown slug={slug} currency={cur} target={target} platforms={platforms} campaigns={numbers.campaigns} total={numbers.mtd.spend} /> : null,
          ads: through ? <AdsPanel slug={slug} currency={cur} best={best} tiring={tiring} unknown={liveAds.filter((a) => a.firstSeenCapped).length} previews={previews} /> : null,
          changes: changesDetail,
          plans: plansDetail,
        }}
      />
    )
  }

  return (
    <div className="space-y-12">
      <SectionNav sections={SECTIONS.filter((x) => (x.id === "spend" ? numbers && platforms.length > 0 : x.id === "ads" ? Boolean(through) : x.id === "content" ? Boolean(ideas) : true))} />

      {/* 1. Summary: how the month is going, in one sentence and three numbers */}
      <section id="summary" className="scroll-mt-28 space-y-5">
        {numbers ? (
          <>
            <div className="space-y-2">
              <p className="eyebrow">
                {monthName(numbers.month)} so far · to {shortDate(numbers.dataThrough)}, day {numbers.daysElapsed} of {numbers.daysInMonth}
              </p>
              <Headline name={client.name} currency={cur} target={target} budget={budget} expected={expected} month={monthName(numbers.month)} spend={numbers.mtd.spend} results={numbers.mtd.results} cpr={numbers.mtd.cpr} />
            </div>

            {goalViews.map((g) => (
              <GoalCard key={g.id} slug={slug} goal={g} canEdit={isAdmin(me)} />
            ))}

            <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
              <Tile label="Spent" hint="What we've paid the ad platforms this month, against the month's budget." value={money(numbers.mtd.spend, cur)}>
                {budget > 0 ? (
                  <span className="block space-y-1.5">
                    <span className="relative block h-1.5 overflow-hidden rounded-full bg-secondary">
                      <span className={cn("absolute inset-y-0 left-0 rounded-full", paceTone(numbers.mtd.spend, expected, budget))} style={{ width: `${Math.min(100, (numbers.mtd.spend / budget) * 100)}%` }} />
                      <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${Math.min(100, (expected / budget) * 100)}%` }} aria-hidden />
                    </span>
                    <span className="block">
                      of {money(budget, cur)} budget · {paceWords(numbers.mtd.spend, expected, budget)}
                    </span>
                  </span>
                ) : (
                  "No budget set"
                )}
              </Tile>
              <Tile label="Results" hint="A result is a conversion or a lead: someone filling in a form, booking a demo or signing up after seeing an ad." value={whole(numbers.mtd.results)}>
                <Delta now={numbers.mtd.results} before={numbers.lastMonthSameDays.results} betterUp /> against the same days last month ({whole(numbers.lastMonthSameDays.results)})
              </Tile>
              <Tile label="Cost per result" hint="Spend divided by results: what each result cost us. Lower is better." value={money(numbers.mtd.cpr, cur)} valueClass={cprTone(numbers.mtd.cpr, target)}>
                {target ? (
                  <span className={cprTone(numbers.mtd.cpr, target)}>
                    {numbers.mtd.cpr === null ? `Target ${money(target, cur)}` : numbers.mtd.cpr <= target ? `Under the ${money(target, cur)} target` : `${Math.round((numbers.mtd.cpr / target - 1) * 100)}% over the ${money(target, cur)} target`}
                  </span>
                ) : (
                  "No target set"
                )}
                {numbers.lastMonthSameDays.cpr !== null && <span className="block">Last month at this point: {money(numbers.lastMonthSameDays.cpr, cur)}</span>}
              </Tile>
            </dl>
          </>
        ) : (
          <>
            {goalViews.map((g) => (
              <GoalCard key={g.id} slug={slug} goal={g} canEdit={isAdmin(me)} />
            ))}
            <p className="surface px-5 py-8 text-center text-sm text-muted-foreground">No ad data yet. Once an ad account is connected and synced, this month&apos;s numbers show here.</p>
          </>
        )}
      </section>

      {/* 2. Where the money went */}
      {numbers && platforms.length > 0 && (
        <section id="spend" className="scroll-mt-28 space-y-4">
          <Heading title="Where the money went" description={`${monthName(numbers.month)} so far, by platform and by campaign. Colors compare cost per result with the ${money(target, cur)} target: green under it, amber up to 20% over, red further.`} />
          <SpendBreakdown slug={slug} currency={cur} target={target} platforms={platforms} campaigns={numbers.campaigns} total={numbers.mtd.spend} />
        </section>
      )}

      {/* 3. Ads */}
      {through && (
        <section id="ads" className="scroll-mt-28 space-y-4">
          <Heading title="Ads" description="Which ads are doing the work, and which have run long enough that people are tuning them out." />
          <AdsPanel slug={slug} currency={cur} best={best} tiring={tiring} unknown={liveAds.filter((a) => a.firstSeenCapped).length} previews={previews} />
        </section>
      )}

      {/* 3b. Content ideas: what content works for whom, and what to make next */}
      {ideas && (
        <section id="content" className="scroll-mt-28 space-y-4">
          <Heading title="Content ideas" description="Which content is working and for whom, and Claude's ideas for content, ads and angles to brief in or test, each matched to the audience it's for." />
          <ContentIdeas slug={slug} currency={cur} {...ideas} />
        </section>
      )}

      {/* 4. What's changed */}
      <section id="changes" className="scroll-mt-28 space-y-4">
        <Heading
          title="What's changed"
          description="Everything done to the account in the last 60 days: changes the team logged, what Google Ads and Meta recorded, what we can see on LinkedIn, and what was done in this app."
          action={
            <Link href={`/clients/${slug}/sprint#change-log`} className="text-xs text-muted-foreground hover:text-foreground">
              Log a change →
            </Link>
          }
        />
        {changesDetail}
      </section>

      {/* 5. What's planned */}
      <section id="plans" className="scroll-mt-28 space-y-4">
        <Heading
          title="What's planned"
          description="We work in two-week sprints. Each sprint runs a few tests (a new audience, ad or bid approach) and keeps what works."
          action={
            <Link href={`/clients/${slug}/sprint`} className="text-xs text-muted-foreground hover:text-foreground">
              Open the sprint board →
            </Link>
          }
        />
        {plansDetail}
      </section>
    </div>
  )
}

/** The month in one plain sentence: spend against budget and pace, then results against target. */
function Headline({ name, currency, target, budget, expected, month, spend, results, cpr, compact }: { name: string; currency: string; target: number | null; budget: number; expected: number; month: string; spend: number; results: number; cpr: number | null; compact?: boolean }) {
  const pace = budget > 0 ? paceWords(spend, expected, budget) : null
  const paceBad = pace && pace !== "on pace" && (spend > budget || Math.abs(spend / expected - 1) > 0.2)
  return (
    <p className={cn("font-heading leading-snug", compact ? "max-w-5xl text-lg sm:text-xl" : "max-w-3xl text-2xl sm:text-3xl")}>
      {name} has spent {money(spend, currency)}
      {budget > 0 ? ` of its ${money(budget, currency)} ${month} budget` : ` in ${month}`}
      {pace && (
        <>
          {pace === "on pace" ? ", " : " and is "}
          <span className={pace === "on pace" ? "text-rag-green" : paceBad ? "text-rag-red" : "text-rag-amber"}>{pace === "on pace" ? "right on pace" : pace}</span>
        </>
      )}
      .{" "}
      {results > 0 && cpr !== null ? (
        <>
          That&apos;s {whole(results)} result{Math.round(results) === 1 ? "" : "s"} at <span className={cprTone(cpr, target)}>{money(cpr, currency)} each</span>
          {target ? (cpr <= target ? `, under the ${money(target, currency)} target.` : `, ${Math.round((cpr / target - 1) * 100)}% over the ${money(target, currency)} target.`) : "."}
        </>
      ) : spend > 0 ? (
        <span className="text-rag-amber">No results yet this month.</span>
      ) : null}
    </p>
  )
}

function Heading({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-2xl">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

function Tile({ label, hint, value, valueClass, children }: { label: string; hint: string; value: string; valueClass?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-5 py-5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        <Hint>{hint}</Hint>
      </dt>
      <dd className={cn("mt-2 font-heading text-4xl leading-none tabular-nums", valueClass)}>{value}</dd>
      <dd className="mt-3 text-xs text-muted-foreground">{children}</dd>
    </div>
  )
}

/** A change in %, green when it's the good direction. */
function Delta({ now, before, betterUp = false }: { now: number | null; before: number | null; betterUp?: boolean }) {
  const pct = now === null || before === null || before === 0 ? null : (now / before - 1) * 100
  if (pct === null) return <span>–</span>
  const good = betterUp ? pct > 0 : pct < 0
  return <span className={cn("tabular-nums", Math.abs(pct) < 1 ? "" : good ? "text-rag-green" : "text-rag-red")}>{`${pct > 0 ? "+" : ""}${Math.round(pct)}%`}</span>
}
