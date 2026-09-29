import Link from "next/link"
import { notFound } from "next/navigation"
import { PlatformIcon } from "@/components/brand"
import { getAccountNumbers } from "@/lib/account"
import { londonToday } from "@/lib/checks/periods"
import { money, shortDate } from "@/lib/format"
import { cachedPacing } from "@/lib/metrics/cached"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { sprintByNumber, sprintDay, sprintOf, SPRINT_DAYS } from "@/lib/sprints/periods"
import { STAGES, stageOf, type TestStatus } from "@/lib/sprints/tests"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { loadTimeline } from "@/lib/timeline"
import { cn } from "@/lib/utils"
import { CampaignSpend } from "./campaign-spend"
import { Timeline } from "./timeline"

export const metadata = { title: "Account" }

/** How far a cost per result is from target: on target, within 20% over, or further off. */
function targetTone(cpr: number | null, target: number | null): "good" | "near" | "off" | "none" {
  if (cpr === null || target === null) return "none"
  if (cpr <= target) return "good"
  return cpr <= target * 1.2 ? "near" : "off"
}
const TONE = { good: "text-rag-green", near: "text-rag-amber", off: "text-rag-red", none: "text-muted-foreground" } as const
const change = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : (now / before - 1) * 100)

/**
 * The Account tab (Dean, 2026-09-29): the holistic view for account managers. Are we on budget and
 * on target this month, what's planned and running in the sprint, where the money goes, and above
 * all what's been changed on the account (by the team, by the platforms, through the app).
 */
export default async function AccountPage({ params }: PageProps<"/clients/[slug]/account">) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, name, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const today = londonToday()
  const period = sprintOf(today)
  const since = new Date(Date.parse(today) - 60 * 864e5).toISOString()

  const [numbers, pacing, { data: sprints }, timeline] = await Promise.all([
    getAccountNumbers(supabase, client.id),
    cachedPacing(client.id), // access confirmed above (client loaded through RLS)
    supabase.from("sprints").select("id, number, start_date, end_date, key_takeaway, closed_at").eq("client_id", client.id).in("start_date", [sprintByNumber(period.number - 1).start, period.start, sprintByNumber(period.number + 1).start]),
    loadTimeline(supabase, createAdminClient(), client, since), // admin only reads the Notion write log, after the RLS check
  ])
  const byNumber = new Map((sprints ?? []).map((s) => [s.number as number, s]))
  const current = byNumber.get(period.number)
  const next = byNumber.get(period.number + 1)
  const previous = byNumber.get(period.number - 1)
  const ids = [current?.id, next?.id, previous?.id].filter(Boolean) as string[]
  const { data: tests } = ids.length
    ? await supabase.from("sprint_tests").select("id, sprint_id, title, platform, status, outcome, owner_name, deadline, live_on").in("sprint_id", ids).order("created_at")
    : { data: [] }
  const testsOf = (id?: string) => (tests ?? []).filter((t) => t.sprint_id === id)
  const now = testsOf(current?.id)
  const stages = STAGES.map((s) => ({ ...s, tests: now.filter((t) => stageOf({ status: t.status as TestStatus, outcome: t.outcome }, null) === s.key) }))
  const prevTests = testsOf(previous?.id)

  const pacingBy = new Map((pacing?.pacing ?? []).map((p) => [p.platform, p]))
  const budget = (pacing?.pacing ?? []).reduce((s, p) => s + (p.budget ?? 0), 0)
  const expected = (pacing?.pacing ?? []).reduce((s, p) => s + (p.budget ? p.expected : 0), 0)
  const tone = targetTone(numbers?.mtd.cpr ?? null, target)

  return (
    <div className="space-y-10">
      <div className="space-y-1">
        <h2 className="text-2xl">Account</h2>
        <p className="text-sm text-muted-foreground">
          What&apos;s happening on {client.name} and what we&apos;re doing about it.
          {numbers && ` This month to ${shortDate(numbers.dataThrough)} (day ${numbers.daysElapsed} of ${numbers.daysInMonth}), against the same days last month.`}
        </p>
      </div>

      {/* This month at a glance */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        <Tile label="Spend this month" value={numbers ? money(numbers.mtd.spend, cur) : "–"}>
          {budget > 0 && numbers ? (
            <>
              of {money(budget, cur)} budget ·{" "}
              <span className={cn(Math.abs(numbers.mtd.spend / Math.max(expected, 1) - 1) > 0.2 ? "text-rag-red" : Math.abs(numbers.mtd.spend / Math.max(expected, 1) - 1) > 0.1 ? "text-rag-amber" : "text-rag-green")}>{Math.round((numbers.mtd.spend / Math.max(expected, 1)) * 100)}% of pace</span>
            </>
          ) : (
            "No budget set"
          )}
        </Tile>
        <Tile label="Results this month" value={numbers ? String(Math.round(numbers.mtd.results * 10) / 10) : "–"}>
          <Delta now={numbers?.mtd.results ?? null} before={numbers?.lastMonthSameDays.results ?? null} betterUp /> vs last month
        </Tile>
        <Tile label="Cost per result" value={numbers?.mtd.cpr ? money(numbers.mtd.cpr, cur) : "–"} valueClass={TONE[tone]}>
          {target ? (
            <span className={TONE[tone]}>{tone === "good" ? "On target" : tone === "none" ? `Target ${money(target, cur)}` : `${Math.round(((numbers!.mtd.cpr! / target) - 1) * 100)}% over the ${money(target, cur)} target`}</span>
          ) : (
            "No target set"
          )}
        </Tile>
        <Tile label={`Sprint ${period.number}`} value={`Day ${sprintDay(period, today)} of ${SPRINT_DAYS}`}>
          {now.length ? `${now.length} test${now.length === 1 ? "" : "s"}: ${now.filter((t) => t.status === "live" && !t.outcome).length} live, ${now.filter((t) => t.outcome).length} called` : "No tests planned yet"}
        </Tile>
      </dl>

      {/* Budget and targets per platform */}
      {numbers && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Budget and targets by platform</h3>
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2.5 text-left font-normal">Platform</th>
                  <th className="px-3 py-2.5 text-right font-normal">Spend</th>
                  <th className="px-3 py-2.5 text-left font-normal">Pacing</th>
                  <th className="px-3 py-2.5 text-right font-normal">Results</th>
                  <th className="px-3 py-2.5 text-right font-normal">Cost per result</th>
                  <th className="px-4 py-2.5 text-right font-normal">vs last month</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {numbers.byPlatform
                  .filter((p) => p.mtd.spend > 0 || pacingBy.get(p.platform)?.budget)
                  .map((p) => {
                    const pc = pacingBy.get(p.platform)
                    const t = targetTone(p.mtd.cpr, target)
                    return (
                      <tr key={p.platform}>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <PlatformIcon platform={p.platform} />
                            {PLATFORM_LABEL[p.platform]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {money(p.mtd.spend, cur)}
                          {pc?.budget ? <span className="block text-xs text-muted-foreground">of {money(pc.budget, cur)}</span> : null}
                        </td>
                        <td className="px-3 py-3">{pc ? <PaceBar ratio={pc.ratio} status={pc.status} spend={p.mtd.spend} budget={pc.budget} expected={pc.expected} /> : <span className="text-xs text-muted-foreground">No budget</span>}</td>
                        <td className="px-3 py-3 text-right">{Math.round(p.mtd.results * 10) / 10}</td>
                        <td className={cn("px-3 py-3 text-right", TONE[t])}>{p.mtd.cpr ? money(p.mtd.cpr, cur) : "–"}</td>
                        <td className="px-4 py-3 text-right text-xs">
                          <Delta now={p.mtd.cpr} before={p.lastMonthSameDays.cpr} /> cost per result
                          <span className="block text-muted-foreground">
                            <Delta now={p.mtd.spend} before={p.lastMonthSameDays.spend} neutral /> spend
                          </span>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
          {target && <p className="text-xs text-muted-foreground">Target cost per result {money(target, cur)}: green on target, amber within 20% over, red further off. Pacing is spend against where the month&apos;s budget says it should be today.</p>}
        </section>
      )}

      {/* Sprints */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-lg font-semibold">Sprints</h3>
          <Link href={`/clients/${slug}/sprint`} className="text-xs text-muted-foreground hover:text-foreground">
            Open the sprint board →
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="surface p-5">
            <p className="text-sm font-medium">
              Sprint {period.number} · {shortDate(period.start)} – {shortDate(period.end)}
            </p>
            {now.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nothing planned yet for this sprint.</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {stages
                  .filter((s) => s.tests.length)
                  .map((s) => (
                    <div key={s.key} className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {s.label} <span className="tabular-nums">{s.tests.length}</span>
                      </p>
                      <ul className="space-y-1.5">
                        {s.tests.map((t) => (
                          <li key={t.id}>
                            <Link href={`/clients/${slug}/sprint#test-${t.id}`} className="flex items-start gap-2 rounded-md border bg-background/40 px-2.5 py-2 text-sm hover:border-foreground/25">
                              <PlatformIcon platform={(t.platform as Platform) ?? null} className="mt-0.5 size-3.5" />
                              <span className="min-w-0 flex-1">
                                <span className="line-clamp-2 leading-snug">{t.title}</span>
                                <span className="block text-[11px] text-muted-foreground">
                                  {[t.owner_name, t.outcome ? t.outcome.charAt(0).toUpperCase() + t.outcome.slice(1) : t.live_on ? `live since ${shortDate(t.live_on)}` : t.deadline ? `due ${shortDate(t.deadline)}` : null].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="surface p-5 text-sm">
              <p className="font-medium">Next: Sprint {period.number + 1}</p>
              <p className="mt-1 text-muted-foreground">{shortDate(sprintByNumber(period.number + 1).start)} – {shortDate(sprintByNumber(period.number + 1).end)}</p>
              {testsOf(next?.id).length ? (
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {testsOf(next?.id).map((t) => (
                    <li key={t.id}>{t.title}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">Nothing planned yet. Carried-over tests and new plans appear here.</p>
              )}
            </div>
            {previous && (
              <div className="surface p-5 text-sm">
                <p className="font-medium">Last: Sprint {previous.number}</p>
                <p className="mt-1 text-muted-foreground">
                  {prevTests.filter((t) => t.outcome === "proven").length} proven · {prevTests.filter((t) => t.outcome === "disproven").length} disproven · {prevTests.filter((t) => t.outcome === "carried").length} carried
                </p>
                {previous.key_takeaway && <p className="mt-2">{previous.key_takeaway}</p>}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Change history: the main thing */}
      <section id="changes" className="scroll-mt-6 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">Change history</h3>
            <p className="text-sm text-muted-foreground">The last 60 days: changes the team logged, what Google Ads and Meta recorded (who, when, how), what we detect on LinkedIn, and what we did in the app.</p>
          </div>
          <Link href={`/clients/${slug}/sprint#change-log`} className="text-xs text-muted-foreground hover:text-foreground">
            Log a change →
          </Link>
        </div>
        <Timeline entries={timeline} />
      </section>

      {numbers && numbers.campaigns.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Spend by campaign this month</h3>
          <CampaignSpend slug={slug} currency={cur} target={target} campaigns={numbers.campaigns} total={numbers.mtd.spend} />
        </section>
      )}
    </div>
  )
}

function Tile({ label, value, valueClass, children }: { label: string; value: string; valueClass?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 font-heading text-3xl leading-none tabular-nums", valueClass)}>{value}</dd>
      <dd className="mt-2 text-xs text-muted-foreground">{children}</dd>
    </div>
  )
}

/** A change in %, green when it's the good direction. `neutral` = no colour (e.g. spend). */
function Delta({ now, before, betterUp = false, neutral = false }: { now: number | null; before: number | null; betterUp?: boolean; neutral?: boolean }) {
  const pct = change(now, before)
  if (pct === null) return <span className="text-muted-foreground">–</span>
  const good = betterUp ? pct > 0 : pct < 0
  return <span className={cn("tabular-nums", neutral || Math.abs(pct) < 1 ? "text-muted-foreground" : good ? "text-rag-green" : "text-rag-red")}>{`${pct > 0 ? "+" : ""}${Math.round(pct)}%`}</span>
}

function PaceBar({ ratio, status, spend, budget, expected }: { ratio: number | null; status: string; spend: number; budget: number | null; expected: number }) {
  if (!budget) return <span className="text-xs text-muted-foreground">No budget</span>
  const pct = Math.min(1.5, spend / budget)
  const mark = Math.min(1, expected / budget)
  const colour = status === "red" ? "bg-rag-red" : status === "amber" ? "bg-rag-amber" : "bg-rag-green"
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1.5 w-28 overflow-hidden rounded-full bg-secondary">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", colour)} style={{ width: `${Math.min(100, pct * 100)}%` }} />
        <span className="absolute inset-y-[-2px] w-px bg-foreground/60" style={{ left: `${mark * 100}%` }} aria-hidden />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{ratio !== null ? `${Math.round(ratio * 100)}%` : "–"}</span>
    </span>
  )
}

