import Link from "next/link"
import { notFound } from "next/navigation"
import { Hint } from "@/components/hint"
import { SectionNav } from "@/components/section-nav"
import { getAccountNumbers, latestDataDay } from "@/lib/account"
import { getProfile, isAdmin } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { money, shortDate, whole } from "@/lib/format"
import { newLayout } from "@/lib/lens"
import { cachedOverview, cachedPacing } from "@/lib/metrics/cached"
import { sprintOf } from "@/lib/sprints/periods"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { loadTimeline } from "@/lib/timeline"
import { cn } from "@/lib/utils"
import { AdsPanel } from "./_glance/ads-panel"
import { ContentIdeas } from "./_glance/content-ideas"
import { loadContentIdeas } from "./_glance/content-ideas-data"
import { GoalCard } from "./_glance/goal-card"
import { GlanceBoard } from "./_glance/glance-board"
import { GlanceCards } from "./_glance/glance-cards"
import { loadAds, loadGoals, loadPlans, monthName, recentOf, spendOf } from "./_glance/glance-data"
import { ChangesDetail, PlansDetail } from "./_glance/glance-details"
import { SpendBreakdown } from "./_glance/spend-breakdown"
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

/**
 * At a glance, the first client tab (Dean, 2026-09-29; was "Account"): how the account is doing, for anyone, with or without a paid
 * media background. It reads top to bottom as a story: how the month is going, where the money went,
 * which ads work and which are tiring, what's been changed, and what's planned.
 */
export default async function AtAGlancePage({ params }: PageProps<"/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, slug, name, currency, monthly_kpi_target").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const today = londonToday()
  const period = sprintOf(today)
  const throughP = latestDataDay(supabase, client.id)

  // New layout (Dean, 2026-10-15: show pages in pieces): only the month line, the tiles and the spend card wait;
  // the Ads, What's changed and What's planned cards stream in with a spinner while they load.
  if (newLayout(me.preferences)) {
    const [numbers, pacing, goals] = await Promise.all([
      getAccountNumbers(supabase, client.id, throughP),
      cachedPacing(client.id), // access confirmed above (client loaded through RLS)
      loadGoals(supabase, client.id, today),
    ])
    const { budget, expected, platforms } = spendOf(numbers, pacing)
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
        goals={goals}
        canEditGoals={isAdmin(me)}
        platforms={platforms}
        headline={numbers ? <Headline name={client.name} currency={cur} target={target} budget={budget} expected={expected} month={monthName(numbers.month)} spend={numbers.mtd.spend} results={numbers.mtd.results} cpr={numbers.mtd.cpr} compact /> : null}
        spendDetail={numbers && platforms.length > 0 ? <SpendBreakdown slug={slug} currency={cur} target={target} platforms={platforms} campaigns={numbers.campaigns} total={numbers.mtd.spend} /> : null}
        cards={<GlanceCards supabase={supabase} slug={slug} client={client} today={today} period={period} through={throughP} />}
      />
    )
  }

  // Classic layout: one long page, so everything loads at once (all reads start together).
  const since = new Date(Date.parse(today) - 60 * 864e5).toISOString()
  const [numbers, through, pacing, overview, plans, timeline, goalViews, ideas] = await Promise.all([
    getAccountNumbers(supabase, client.id, throughP),
    throughP,
    cachedPacing(client.id),
    cachedOverview(client.id), // live ads and their first vs last 14 days
    loadPlans(supabase, client.id, period),
    loadTimeline(supabase, createAdminClient(), client, since), // admin only reads the Notion write log, after the RLS check
    loadGoals(supabase, client.id, today),
    throughP.then((t) => (t ? loadContentIdeas(supabase, client, today) : null)),
  ])
  const { budget, expected, platforms } = spendOf(numbers, pacing)
  const ads = through ? await loadAds(supabase, client.id, through, overview?.liveAds ?? []) : null
  const { recent, by: recentBy } = recentOf(timeline, today)
  const changesDetail = <ChangesDetail timeline={timeline} recent={recent} by={recentBy} />
  const plansDetail = <PlansDetail slug={slug} period={period} today={today} plans={plans} />

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

            <dl className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
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
          {ads && <AdsPanel slug={slug} currency={cur} best={ads.best} tiring={ads.tiring} unknown={ads.unknown} previews={ads.previews} />}
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
