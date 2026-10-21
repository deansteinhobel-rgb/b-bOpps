import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { ActionForm } from "@/components/action-form"
import { SectionLoading, Spinner } from "@/components/loading"
import { NotionSyncBar } from "@/components/notion-sync-bar"
import { StatusBadge } from "@/components/status-badge"
import { aiConfigured } from "@/lib/ai/claude"
import { canEdit, getProfile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { longDate, money, oneDp, signedPct } from "@/lib/format"
import { addDays, pctChange } from "@/lib/metrics/ads"
import { isPlatform, PLATFORM_LABEL, PLATFORMS } from "@/lib/metrics/types"
import { refreshPlan, weeklySnapshot } from "@/lib/reports/weekly"
import { byDue, lastNotionSync, minutesAgo, mirrorItems } from "@/lib/notion/mirror"
import { notionWritesLive } from "@/lib/notion/server"
import { peopleForClient } from "@/lib/people"
import { testBoardData } from "@/lib/sprints/board"
import { cachedSprintNumbers, ensureSprint, loadSprintDetails, type Sprint } from "@/lib/sprints/data"
import { suggestChanges, type Suggestion } from "@/lib/sprints/detect"
import { sprintByNumber, sprintDay, sprintOf, SPRINT_DAYS } from "@/lib/sprints/periods"
import { CARRY_REASONS, stageOf, type Stage } from "@/lib/sprints/tests"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { canWriteGoogleAds } from "@/lib/windsor/access"
import { canBuildCampaigns } from "@/lib/ads-api/access"
import { cn } from "@/lib/utils"
import { AiPanel, type AiRun, type PourHistoryRow, type Recommendation } from "./ai-panel"
import { ChangeLog } from "./change-log"
import { CloseSprint } from "./close-sprint"
import { EditableText } from "./editable-text"
import { PlanTestForm, type PlanPrefill } from "./plan-test-form"
import { TestBoard } from "./test-board"
import { TestCard } from "./test-card"
import { loadTargets } from "@/lib/targets"
import { fromJson } from "@/lib/supabase/db"


export default async function SprintPage({ params, searchParams }: PageProps<"/clients/[slug]/sprint">) {
  const { slug } = await params
  const { n, refresh, week } = await searchParams
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, currency, monthly_kpi_target").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()

  const today = londonToday()
  const current = sprintOf(today)
  const requested = typeof n === "string" && /^-?\d+$/.test(n) ? Number(n) : current.number
  if (requested > current.number) notFound()
  const period = requested === current.number ? current : sprintByNumber(requested)
  const isCurrent = period.number === current.number

  // The current sprint is created on first view; earlier ones only exist if someone used them.
  let sprint: Sprint | null
  // Viewers can't write, so the empty sprint (and its carry-overs) is made for them with the admin
  // client; access was confirmed above and only this client's sprint is touched.
  if (isCurrent) sprint = await ensureSprint(canEdit(me) ? supabase : createAdminClient(), client.id, period)
  else sprint = (await supabase.from("sprints").select("*").eq("client_id", client.id).eq("start_date", period.start).maybeSingle()).data as Sprint | null
  if (!sprint) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl">Sprint {period.number}</h2>
        <p className="text-muted-foreground">
          No sprint was recorded for {longDate(period.start)} – {longDate(period.end)}.
        </p>
        <Link href={`/clients/${slug}/sprint`} className="text-sm underline">
          Go to the current sprint
        </Link>
      </div>
    )
  }

  // Shown in pieces (Dean, 2026-10-15): the plan, the review and the pours show straight away; the Windsor numbers
  // (stats, the review's spend line, detected changes) and the test board's live results stream in behind them.
  // Everything starts at once; the board chains straight off the tests.
  const detailsP = loadSprintDetails(supabase, sprint)
  const targetsP = loadTargets(supabase, client.id, client.monthly_kpi_target)
  const closed = Boolean(sprint.closed_at)
  // A closed sprint keeps its numbers and has no suggestions, so it never waits on Windsor.
  const frozen = closed && sprint.summary ? sprint.summary : null
  const numbersP = frozen ? null : cachedSprintNumbers(client.id, period) // access confirmed: sprint loaded through RLS
  const shownP = frozen ? Promise.resolve(frozen) : numbersP!.then((x) => x.summary)
  const boardP = Promise.all([detailsP, targetsP]).then(([d, targets]) => testBoardData(supabase, client.id, d.tests, { currency: client.currency, targets }))
  const [details, notionSynced, { data: accounts }, { data: runs }, actions, owners, { data: aiRuns }, { data: aiRecs }, { data: pourRuns }, { data: pourRecs }] = await Promise.all([
    detailsP,
    detailsP.then((d) => (d.tests.some((t) => t.notion_page_id) ? lastNotionSync(supabase).then(minutesAgo) : null)),
    // The plan form's platforms: the client's ad accounts, so it doesn't wait on the numbers.
    supabase.from("client_platform_accounts").select("platform").eq("client_id", client.id).eq("active", true),
    supabase
      .from("check_runs")
      .select("id, check_results(id, status, findings, notion_action_page_id, check_definitions(name))")
      .eq("client_id", client.id)
      .eq("cadence", "weekly")
      .gte("period_start", period.start)
      .lte("period_start", period.end),
    mirrorItems(supabase, client.id, "action"),
    peopleForClient(supabase, client.id),
    supabase.from("sprint_ai_runs").select("id, status, created_at, market_summary, news, error").eq("sprint_id", sprint.id).is("archived_at", null).order("created_at", { ascending: false }).limit(1),
    // Archived runs' suggestions are hidden (kept in the database, never deleted).
    supabase.from("sprint_recommendations").select("*, sprint_ai_runs!inner(archived_at)").eq("sprint_id", sprint.id).is("sprint_ai_runs.archived_at", null).order("created_at", { ascending: false }).order("position"),
    // Pour history: every (unarchived) pour for this client, across sprints.
    supabase.from("sprint_ai_runs").select("id, status, created_at, sprint_id, sprints(number), profiles(full_name)").eq("client_id", client.id).is("archived_at", null).order("created_at", { ascending: false }).limit(30),
    supabase.from("sprint_recommendations").select("run_id, status, sprint_ai_runs!inner(archived_at)").eq("client_id", client.id).is("sprint_ai_runs.archived_at", null),
  ])
  const pourHistory: PourHistoryRow[] = (pourRuns ?? []).map((r) => {
    const mine = (pourRecs ?? []).filter((x) => x.run_id === r.id)
    return {
      id: r.id,
      status: r.status as PourHistoryRow["status"],
      created_at: r.created_at,
      sprintNumber: r.sprints?.number ?? 0,
      thisSprint: r.sprint_id === sprint.id,
      by: r.profiles?.full_name ?? null,
      total: mine.length,
      approved: mine.filter((x) => x.status === "approved").length,
      rejected: mine.filter((x) => x.status === "rejected").length,
      open: mine.filter((x) => x.status === "draft" || x.status === "reviewed").length,
    }
  })
  const { changes, history, previous, tests } = details
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const day = sprintDay(period, today)
  const writesLive = notionWritesLive(slug)
  const canBuildGoogle = !closed && (accounts ?? []).some((a) => a.platform === "google_ads") && (await canWriteGoogleAds(me, client.id))
  const platforms = PLATFORMS.filter((p) => (accounts ?? []).some((a) => a.platform === p))
  // Campaigns for a test are planned and built (or edited) in the Campaign builder (Dean, 2026-10-21).
  const buildPlatforms = !closed && (await canBuildCampaigns(me, client.id)) ? platforms : []
  const ownerOptions = owners.map((p) => ({ id: p.notionUserId, name: p.name, onTeam: p.onTeam }))
  const withoutOutcome = tests.filter((t) => !t.outcome).length

  // "Replace weak ads" from the weekly Slack snapshot (Dean, 2026-10-20): the plan form opens filled in
  // with that week's weakest and stale ads on the platform. Access confirmed above (client loaded through RLS).
  let prefill: PlanPrefill | null = null
  const weekFrom = typeof week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : null
  if (!closed && isCurrent && canEdit(me) && isPlatform(refresh) && weekFrom) {
    const snap = await weeklySnapshot(createAdminClient(), client.id, { from: weekFrom, to: addDays(weekFrom, 6) })
    const plan = snap && refreshPlan(snap, refresh, PLATFORM_LABEL[refresh], (v) => money(v, cur))
    if (plan) prefill = { ...plan, platform: platforms.includes(refresh) ? refresh : "", source: `the weekly Slack snapshot (week of ${longDate(weekFrom)})` }
  }

  const knownKeys = new Set(changes.map((c) => c.detected_key).filter(Boolean))
  const suggestionsP: Promise<Suggestion[]> =
    closed || !numbersP
      ? Promise.resolve([])
      : numbersP.then(({ summary, events, detectionDaily }) => {
          const detectTo = summary.dataThrough && summary.dataThrough < period.end ? summary.dataThrough : period.end
          return suggestChanges({ events, daily: detectionDaily, from: period.start, to: detectTo, currency: cur }).filter((s) => !knownKeys.has(s.key))
        })
  const results = (runs ?? []).flatMap((r) => (r.check_results ?? []) as unknown as { id: string; status: string | null; findings: string | null; notion_action_page_id: string | null; check_definitions: { name: string } | null }[])
  const reds = results.filter((r) => r.status === "red")
  const openActions = actions.filter((a) => !a.closed).sort(byDue)

  // Streamed sections: promises React renders inside Suspense when they settle.
  const numbersSection = shownP.then((shown) => (
    <>
      {shown.dataThrough && shown.dataThrough < period.start && (
        <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
          No ad data for this sprint yet: Windsor data runs through {longDate(shown.dataThrough)} and syncs daily.
        </p>
      )}
      {/* One box split by hairlines (taste skill: group, don't box): each cell draws its left and top
          line, and the grid sits 1px up and left so the outer ones are clipped. */}
      <div className="surface overflow-hidden">
      <div className="-mt-px -ml-px grid sm:grid-cols-2 lg:grid-cols-4 [&>*]:shadow-[inset_1px_1px_0_var(--border)]">
        <Stat label="Spend" value={money(shown.current.spend, cur)} change={pctChange(shown.current.spend, shown.previous.spend)} />
        <Stat label="Results" value={oneDp(shown.current.results)} change={pctChange(shown.current.results, shown.previous.results)} goodWhenUp />
        <Stat
          label="Cost per result"
          value={money(shown.current.costPerResult, cur)}
          change={pctChange(shown.current.costPerResult, shown.previous.costPerResult)}
          goodWhenDown
          note={target ? `Target ${money(target, cur)}` : undefined}
        />
        <Trend trend={shown.trend} current={period.number} currency={cur} />
      </div>
      </div>
    </>
  ))
  const spendLine = shownP.then((shown) => (
    <li>
      Spend {money(shown.current.spend, cur)} ({signedPct(pctChange(shown.current.spend, shown.previous.spend))}) · {oneDp(shown.current.results)} results · {money(shown.current.costPerResult, cur)} per result
    </li>
  ))
  const boardSection = boardP.then((board) => {
    const staged = tests.map((t) => ({ t, stage: stageOf(t, t.notion_page_id && board.briefs[t.notion_page_id] ? { master: board.briefs[t.notion_page_id].status, paid: board.briefs[t.notion_page_id].paid } : null) }))
    const card = (t: (typeof tests)[number], stage: Stage) => (
      <TestCard
        key={t.id}
        test={t}
        stage={stage}
        brief={t.notion_page_id ? board.briefs[t.notion_page_id] : undefined}
        results={board.results[t.id]}
        detail={board.details[t.id]}
        previews={board.previews}
        campaigns={board.campaigns.filter((c) => !t.platform || c.platform === t.platform)}
        currency={cur}
        readOnly={closed}
        canRename={!closed && canEdit(me)}
        writesLive={writesLive}
        canBuildGoogle={canBuildGoogle}
        buildHref={t.platform && buildPlatforms.includes(t.platform) ? `/clients/${slug}/build?${t.platform === "linkedin" ? "" : `platform=${t.platform}&`}test=${t.id}` : null}
        today={today}
      />
    )
    return <TestBoard items={staged} card={card} />
  })
  const detectedCount = suggestionsP.then((s) => <>{s.length}</>)
  const changeLog = suggestionsP.then((suggestions) => (
    <ChangeLog sprintId={sprint.id} changes={changes} suggestions={suggestions} hypotheses={[]} platforms={platforms} today={today < period.end ? today : period.end} readOnly={closed} />
  ))

  return (
    <div className="space-y-10">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[28px] leading-9">
              Sprint {period.number}{" "}
              <span className="text-xl text-muted-foreground">
                · {longDate(period.start)} – {longDate(period.end)}
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {closed ? <StatusBadge status="na" label="Closed" /> : <StatusBadge status="green" label={isCurrent ? `Day ${day} of ${SPRINT_DAYS}` : "Open"} />}
            <nav className="flex gap-3" aria-label="Sprints">
              <Link href={`/clients/${slug}/sprint?n=${period.number - 1}`} className="underline">
                ← Sprint {period.number - 1}
              </Link>
              {!isCurrent && (
                <Link href={`/clients/${slug}/sprint${period.number + 1 === current.number ? "" : `?n=${period.number + 1}`}`} className="underline">
                  Sprint {period.number + 1} →
                </Link>
              )}
            </nav>
          </div>
        </div>
        {isCurrent && (
          // Where we are in the fortnight: a 2px track, the days gone in white (lime is the selection mark).
          <div className="h-0.5 w-full bg-border" aria-hidden>
            <div className="h-full bg-foreground" style={{ width: `${(day / SPRINT_DAYS) * 100}%` }} />
          </div>
        )}
        {isCurrent && previous && !previous.closed_at && (
          <p className="rounded-md border border-rag-amber/40 bg-rag-amber-bg px-3 py-2 text-sm text-rag-amber">
            Sprint {previous.number} hasn&apos;t been reviewed yet.{" "}
            <Link href={`/clients/${slug}/sprint?n=${previous.number}`} className="underline">
              Review and close it
            </Link>{" "}
            so its carried tests move into this sprint.
          </p>
        )}
      </header>

      {/* Numbers */}
      <section aria-label="Sprint numbers" className="space-y-2">
        <Suspense fallback={<SectionLoading label="Loading the sprint's numbers…" className="min-h-28" lines={2} />}>{numbersSection}</Suspense>
      </section>

      {/* Claude: suggested tests, reviewed then approved into the plan */}
      <AiPanel
        sprintId={sprint.id}
        canGenerate={canEdit(me)}
        aiReady={aiConfigured()}
        closed={closed}
        run={(aiRuns?.[0] as AiRun | undefined) ?? null}
        recs={(aiRecs ?? []).map(
          (r) =>
            ({
              ...r,
              evidence: fromJson<Recommendation["evidence"]>(r.evidence, []),
              sources: fromJson<Recommendation["sources"]>(r.sources, []),
              success_target: r.success_target === null ? null : Number(r.success_target),
            }) as Recommendation, // status and the levels are kept to these by check constraints
        )}
        history={pourHistory}
        owners={ownerOptions}
        defaultDeadline={addDays(period.start, 4)}
        currency={cur}
      />

      {/* Tests board */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl">Tests this sprint</h2>
            <p className="text-sm text-muted-foreground">Plan on the sprint&apos;s first Monday → brief the team in Notion → launch when approved → add findings → call it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {notionSynced && <NotionSyncBar clientSlug={slug} syncedLabel={notionSynced} />}
            <p className="text-sm text-muted-foreground">
              {tests.length} test{tests.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {!closed && <PlanTestForm key={prefill ? `refresh-${refresh}-${weekFrom}` : "plan"} sprintId={sprint.id} platforms={platforms} owners={ownerOptions} defaultDeadline={addDays(period.start, 4)} prefill={prefill} />}
        {tests.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No tests planned yet. Plan one to get the sprint going.</p>
        ) : (
          <Suspense fallback={<SectionLoading label="Loading the test board…" className="min-h-64" lines={5} />}>{boardSection}</Suspense>
        )}
      </section>

      {/* Sprint review: filled in from the tests */}
      <section className="space-y-4">
        <div>
          <h2 className="text-2xl">Sprint review</h2>
          <p className="text-sm text-muted-foreground">Built from the tests. Add the key takeaway, then close the sprint.</p>
        </div>
        <div className="surface space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-lg font-semibold">Sprint {period.number} review</p>
            <p className="text-xs text-muted-foreground">
              {tests.filter((t) => t.outcome === "proven").length} proven · {tests.filter((t) => t.outcome === "disproven").length} disproven ·{" "}
              {tests.filter((t) => t.outcome === "inconclusive").length} inconclusive · {tests.filter((t) => t.outcome === "carried").length} carried over
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <span className="shrink-0 pt-1 text-sm font-semibold">Key takeaway</span>
            <div className="flex-1">
              <EditableText sprintId={sprint.id} field="key_takeaway" initial={sprint.key_takeaway} placeholder="The single most important learning from this sprint…" rows={2} readOnly={closed} label="Key takeaway" />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Box title="Highlights (work done + impact)" accent>
              <ul className="space-y-1">
                <Suspense
                  fallback={
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <Spinner label="Loading spend" /> Loading spend…
                    </li>
                  }
                >
                  {spendLine}
                </Suspense>
                {tests
                  .filter((t) => t.live_on)
                  .map((t) => (
                    <li key={t.id}>
                      {t.platform ? `${PLATFORM_LABEL[t.platform]}: ` : ""}
                      {t.title} (live from {longDate(t.live_on!)})
                    </li>
                  ))}
                {tests.every((t) => !t.live_on) && <li className="text-muted-foreground italic">No tests went live yet.</li>}
              </ul>
            </Box>
            <Box title="Top learnings">
              <ReviewList items={tests.filter((t) => t.findings_worked).map((t) => ({ id: t.id, head: t.title, body: t.findings_worked!, tag: t.outcome ?? undefined }))} empty="Findings (“what worked”) appear here." />
            </Box>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Box title="Challenge & hypotheses why">
              <ReviewList items={tests.filter((t) => t.findings_blockers).map((t) => ({ id: t.id, head: t.title, body: t.findings_blockers! }))} empty="Blockers from findings appear here." />
            </Box>
            <Box title="Mitigation plan">
              <ReviewList
                items={tests.filter((t) => t.outcome === "carried").map((t) => ({ id: t.id, head: t.title, body: `Carried over: ${CARRY_REASONS[t.carry_reason ?? "other"]}${t.carry_note ? `. ${t.carry_note}` : ""}` }))}
                empty="Tests carried into the next sprint appear here."
              />
            </Box>
            <Box title="Progress made">
              <ul className="space-y-1">
                <li>{tests.length} planned</li>
                <li>{tests.filter((t) => t.notion_page_id || t.status !== "planned").length} briefed or ready</li>
                <li>{tests.filter((t) => t.live_on).length} went live</li>
                <li>{tests.filter((t) => t.outcome && t.outcome !== "carried").length} called (proven, disproven or inconclusive)</li>
              </ul>
            </Box>
          </div>
          <div className="rounded-md border bg-background/60 p-3">
            {!closed && withoutOutcome > 0 && (
              <p className="mb-2 text-sm text-rag-amber">
                {withoutOutcome} test{withoutOutcome === 1 ? " has" : "s have"} no outcome yet. Call each one (proven, disproven, inconclusive) or carry it over before closing.
              </p>
            )}
            <CloseSprint sprintId={sprint.id} closed={closed} canReopen={canEdit(me)} carryCount={tests.filter((t) => t.outcome === "carried").length} />
          </div>
        </div>
      </section>

      {/* Secondary: change log, red checks and Notion actions */}
      <details id="change-log" className="scroll-mt-6 rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-lg">
          Change log{" "}
          <span className="text-sm text-muted-foreground">
            ({changes.filter((c) => c.status === "logged").length} logged,{" "}
            <Suspense fallback={<Spinner className="inline size-3 align-[-1px]" label="Loading detected changes" />}>{detectedCount}</Suspense> detected in Windsor)
          </span>
        </summary>
        <div className="mt-4">
          <Suspense fallback={<SectionLoading label="Loading the change log…" lines={3} />}>{changeLog}</Suspense>
        </div>
      </details>

      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-lg">
          Red checks and Notion actions{" "}
          <span className="text-sm text-muted-foreground">
            ({reds.length} red, {openActions.length} open actions)
          </span>
        </summary>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="eyebrow">Red checks this sprint</h3>
            {reds.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No reds.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {reds.map((r) => (
                  <li key={r.id} className="rounded-md border p-3">
                    <p className="font-bold">{r.check_definitions?.name}</p>
                    {r.findings && <p className="line-clamp-2 text-muted-foreground">{r.findings}</p>}
                    <Link href={`/clients/${slug}/checks?result=${r.id}#check-${r.id}`} className="text-xs underline">
                      {r.notion_action_page_id ? "Actioned in Notion: view check" : "Open the check to create an action"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="eyebrow">Open actions in Notion</h3>
            {openActions.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">None.</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {openActions.slice(0, 10).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="line-clamp-1 font-bold">{a.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.status} · {a.owners.join(", ") || "no owner"}
                      </span>
                    </span>
                    <a href={a.url} target="_blank" rel="noreferrer" className="shrink-0 underline">
                      Open in Notion
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {!closed && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm">New action in Notion</summary>
                <div className="mt-3">
                  <ActionForm clientSlug={slug} live={writesLive} owners={ownerOptions} defaults={{ title: "", ownerId: null, dueDate: addDays(today, 7), description: "" }} />
                </div>
              </details>
            )}
          </div>
        </div>
      </details>

      {/* History */}
      <section className="space-y-3">
        <h2 className="text-2xl">Sprint history</h2>
        <ul className="surface divide-y text-sm">
          {history.map((h) => (
            <li key={h.id}>
              <Link href={`/clients/${slug}/sprint${h.number === current.number ? "" : `?n=${h.number}`}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-white/[0.03]">
                <span>
                  <strong>Sprint {h.number}</strong> <span className="text-muted-foreground">· {longDate(h.start_date)}</span>
                  {h.key_takeaway && <span className="mt-0.5 block text-muted-foreground">“{h.key_takeaway}”</span>}
                </span>
                <span className="text-muted-foreground">{h.closed_at ? `Closed · ${money(h.summary?.current.costPerResult ?? null, cur)} per result` : "Open"}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/learnings" className="text-sm underline">
          All test learnings across sprints →
        </Link>
      </section>
    </div>
  )
}

function Box({ title, accent, children }: { title: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border text-sm text-foreground">
      <p className={cn("border-b px-4 py-2.5 text-xs font-medium", accent ? "font-semibold text-foreground" : "text-muted-foreground")}>{title}</p>
      <div className="p-4">{children}</div>
    </div>
  )
}

function ReviewList({ items, empty }: { items: { id: string; head: string; body: string; tag?: string }[]; empty: string }) {
  if (!items.length) return <p className="text-muted-foreground italic">{empty}</p>
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.id}>
          <p className="text-xs text-muted-foreground">
            {i.head}
            {i.tag ? ` · ${i.tag}` : ""}
          </p>
          <p className="whitespace-pre-line">{i.body}</p>
        </li>
      ))}
    </ul>
  )
}

function Stat({ label, value, change, goodWhenUp, goodWhenDown, note }: { label: string; value: string; change?: number | null; goodWhenUp?: boolean; goodWhenDown?: boolean; note?: string }) {
  const good = change === null || change === undefined ? null : goodWhenDown ? change < 0 : goodWhenUp ? change > 0 : null
  return (
    <div className="p-4">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
      {change !== undefined && <p className={cn("text-xs", good === null ? "text-muted-foreground" : good ? "text-rag-green" : "text-rag-red")}>{signedPct(change ?? null)} vs last sprint</p>}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function Trend({ trend, current, currency }: { trend: { number: number; costPerResult: number | null }[]; current: number; currency: string }) {
  const max = Math.max(...trend.map((t) => t.costPerResult ?? 0), 1)
  return (
    <div className="p-4">
      <p className="text-[13px] text-muted-foreground">Cost per result by sprint</p>
      <div className="mt-2 flex h-16 items-end gap-1.5" role="img" aria-label={trend.map((t) => `Sprint ${t.number}: ${t.costPerResult === null ? "no results" : money(t.costPerResult, currency)}`).join(", ")}>
        {trend.map((t) => (
          <div key={t.number} className="flex flex-1 flex-col items-center gap-1" title={`Sprint ${t.number}: ${t.costPerResult === null ? "no results" : money(t.costPerResult, currency)}`}>
            <div className={cn("w-full", t.number === current ? "bg-lime" : "bg-white/20")} style={{ height: `${t.costPerResult ? Math.max((t.costPerResult / max) * 48, 3) : 2}px` }} />
            <span className="text-[11px] text-muted-foreground">{t.number}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
