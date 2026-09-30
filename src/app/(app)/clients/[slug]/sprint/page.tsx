import Link from "next/link"
import { notFound } from "next/navigation"
import { ActionForm } from "@/components/action-form"
import { NotionSyncBar } from "@/components/notion-sync-bar"
import { StatusBadge } from "@/components/status-badge"
import { aiConfigured } from "@/lib/ai/claude"
import { canEdit, getProfile, isAdmin } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { longDate, money, oneDp, signedPct } from "@/lib/format"
import { addDays, pctChange } from "@/lib/metrics/ads"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { byDue, lastNotionSync, minutesAgo, mirrorItems } from "@/lib/notion/mirror"
import { notionWritesLive } from "@/lib/notion/server"
import { peopleForClient } from "@/lib/people"
import { testBoardData } from "@/lib/sprints/board"
import { cachedSprintNumbers, ensureSprint, loadSprintDetails, type Sprint } from "@/lib/sprints/data"
import { suggestChanges } from "@/lib/sprints/detect"
import { sprintByNumber, sprintDay, sprintOf, SPRINT_DAYS } from "@/lib/sprints/periods"
import { CARRY_REASONS, stageOf, type Stage } from "@/lib/sprints/tests"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { AiPanel, type AiRun, type PourHistoryRow, type Recommendation } from "./ai-panel"
import { ChangeLog } from "./change-log"
import { CloseSprint } from "./close-sprint"
import { EditableText } from "./editable-text"
import { PlanTestForm } from "./plan-test-form"
import { TestBoard } from "./test-board"
import { TestCard } from "./test-card"

export default async function SprintPage({ params, searchParams }: PageProps<"/clients/[slug]/sprint">) {
  const { slug } = await params
  const { n } = await searchParams
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

  const [details, numbers, { data: runs }, actions, owners, { data: aiRuns }, { data: aiRecs }, { data: pourRuns }, { data: pourRecs }] = await Promise.all([
    loadSprintDetails(supabase, sprint),
    cachedSprintNumbers(client.id, period), // access confirmed: sprint loaded through RLS
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
      sprintNumber: (r.sprints as unknown as { number: number } | null)?.number ?? 0,
      thisSprint: r.sprint_id === sprint.id,
      by: (r.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
      total: mine.length,
      approved: mine.filter((x) => x.status === "approved").length,
      rejected: mine.filter((x) => x.status === "rejected").length,
      open: mine.filter((x) => x.status === "draft" || x.status === "reviewed").length,
    }
  })
  const { changes, history, previous, tests } = details
  const board = await testBoardData(supabase, client.id, tests)
  const { summary, events, detectionDaily } = numbers
  const closed = Boolean(sprint.closed_at)
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const shown = closed && sprint.summary ? sprint.summary : summary
  const day = sprintDay(period, today)
  const writesLive = notionWritesLive(slug)
  const notionSynced = tests.some((t) => t.notion_page_id) ? minutesAgo(await lastNotionSync(supabase)) : null
  const platforms = summary.byPlatform.map((p) => p.platform)
  const ownerOptions = owners.map((p) => ({ id: p.notionUserId, name: p.name, onTeam: p.onTeam }))

  const staged = tests.map((t) => ({ t, stage: stageOf(t, t.notion_page_id && board.briefs[t.notion_page_id] ? { master: board.briefs[t.notion_page_id].status, paid: board.briefs[t.notion_page_id].paid } : null) }))
  const withoutOutcome = tests.filter((t) => !t.outcome).length

  const knownKeys = new Set(changes.map((c) => c.detected_key).filter(Boolean))
  const detectTo = summary.dataThrough && summary.dataThrough < period.end ? summary.dataThrough : period.end
  const suggestions = closed ? [] : suggestChanges({ events, daily: detectionDaily, from: period.start, to: detectTo, currency: cur }).filter((s) => !knownKeys.has(s.key))
  const results = (runs ?? []).flatMap((r) => (r.check_results ?? []) as unknown as { id: string; status: string | null; findings: string | null; notion_action_page_id: string | null; check_definitions: { name: string } | null }[])
  const reds = results.filter((r) => r.status === "red")
  const openActions = actions.filter((a) => !a.closed).sort(byDue)
  const card = (t: (typeof tests)[number], stage: Stage) => (
    <TestCard
      key={t.id}
      test={t}
      stage={stage}
      brief={t.notion_page_id ? board.briefs[t.notion_page_id] : undefined}
      results={board.results[t.id]}
      campaigns={board.campaigns.filter((c) => !t.platform || c.platform === t.platform)}
      currency={cur}
      readOnly={closed}
      writesLive={writesLive}
      today={today}
    />
  )

  return (
    <div className="space-y-10">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Sprint</p>
            <h2 className="mt-1 text-4xl">
              Sprint {period.number}{" "}
              <span className="text-2xl text-muted-foreground">
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
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
            <div className="h-full bg-lime" style={{ width: `${(day / SPRINT_DAYS) * 100}%` }} />
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
        {shown.dataThrough && shown.dataThrough < period.start && (
          <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
            No ad data for this sprint yet: Windsor data runs through {longDate(shown.dataThrough)} and syncs daily.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      </section>

      {/* Claude: suggested tests, reviewed then approved into the plan */}
      <AiPanel
        sprintId={sprint.id}
        canGenerate={isAdmin(me)}
        aiReady={aiConfigured()}
        closed={closed}
        run={(aiRuns?.[0] as AiRun | undefined) ?? null}
        recs={((aiRecs ?? []) as Recommendation[]).map((r) => ({ ...r, success_target: r.success_target === null ? null : Number(r.success_target) }))}
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
        {!closed && <PlanTestForm sprintId={sprint.id} platforms={platforms} owners={ownerOptions} defaultDeadline={addDays(period.start, 4)} />}
        {tests.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No tests planned yet. Plan one to get the sprint going.</p>
        ) : (
          <TestBoard items={staged} card={card} />
        )}
      </section>

      {/* Sprint review: filled in from the tests */}
      <section className="space-y-4">
        <div>
          <h2 className="text-2xl">Sprint review</h2>
          <p className="text-sm text-muted-foreground">Built from the tests. Add the key takeaway, then close the sprint.</p>
        </div>
        <div className="space-y-4 rounded-xl border border-lime/25 bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-heading text-2xl">Sprint {period.number} review</p>
            <p className="text-xs text-muted-foreground">
              {tests.filter((t) => t.outcome === "proven").length} proven · {tests.filter((t) => t.outcome === "disproven").length} disproven ·{" "}
              {tests.filter((t) => t.outcome === "inconclusive").length} inconclusive · {tests.filter((t) => t.outcome === "carried").length} carried over
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <span className="shrink-0 rounded-full bg-lime px-3 py-1 text-xs font-bold text-ink">Key takeaway</span>
            <div className="flex-1">
              <EditableText sprintId={sprint.id} field="key_takeaway" initial={sprint.key_takeaway} placeholder="The single most important learning from this sprint…" rows={2} readOnly={closed} label="Key takeaway" />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Box title="Highlights (work done + impact)" accent>
              <ul className="space-y-1">
                <li>
                  Spend {money(shown.current.spend, cur)} ({signedPct(pctChange(shown.current.spend, shown.previous.spend))}) · {oneDp(shown.current.results)} results ·{" "}
                  {money(shown.current.costPerResult, cur)} per result
                </li>
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
            <CloseSprint sprintId={sprint.id} closed={closed} isAdmin={isAdmin(me)} carryCount={tests.filter((t) => t.outcome === "carried").length} />
          </div>
        </div>
      </section>

      {/* Secondary: change log, red checks and Notion actions */}
      <details id="change-log" className="scroll-mt-6 rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-lg">
          Change log{" "}
          <span className="text-sm text-muted-foreground">
            ({changes.filter((c) => c.status === "logged").length} logged, {suggestions.length} detected in Windsor)
          </span>
        </summary>
        <div className="mt-4">
          <ChangeLog sprintId={sprint.id} changes={changes} suggestions={suggestions} hypotheses={[]} platforms={platforms} today={today < period.end ? today : period.end} readOnly={closed} />
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
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {history.map((h) => (
            <li key={h.id}>
              <Link href={`/clients/${slug}/sprint${h.number === current.number ? "" : `?n=${h.number}`}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-secondary/50">
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
    <div className="overflow-hidden rounded-lg border bg-background/60 text-sm text-foreground">
      <p className={cn("border-b px-4 py-2.5 text-xs font-medium tracking-wide uppercase", accent ? "border-lime/30 text-lime" : "text-muted-foreground")}>{title}</p>
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
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-2xl tabular-nums">{value}</p>
      {change !== undefined && <p className={cn("text-xs", good === null ? "text-muted-foreground" : good ? "text-rag-green" : "text-rag-red")}>{signedPct(change ?? null)} vs last sprint</p>}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function Trend({ trend, current, currency }: { trend: { number: number; costPerResult: number | null }[]; current: number; currency: string }) {
  const max = Math.max(...trend.map((t) => t.costPerResult ?? 0), 1)
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">Cost per result by sprint</p>
      <div className="mt-2 flex h-16 items-end gap-1.5" role="img" aria-label={trend.map((t) => `Sprint ${t.number}: ${t.costPerResult === null ? "no results" : money(t.costPerResult, currency)}`).join(", ")}>
        {trend.map((t) => (
          <div key={t.number} className="flex flex-1 flex-col items-center gap-1" title={`Sprint ${t.number}: ${t.costPerResult === null ? "no results" : money(t.costPerResult, currency)}`}>
            <div className={cn("w-full rounded-sm", t.number === current ? "bg-lime" : "bg-violet/50")} style={{ height: `${t.costPerResult ? Math.max((t.costPerResult / max) * 48, 3) : 2}px` }} />
            <span className="text-[10px] text-muted-foreground">{t.number}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
