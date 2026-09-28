import Link from "next/link"
import { notFound } from "next/navigation"
import { ActionForm } from "@/components/action-form"
import { StatusBadge } from "@/components/status-badge"
import { getProfile, isAdmin } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { longDate, money, oneDp, signedPct } from "@/lib/format"
import { addDays, pctChange } from "@/lib/metrics/ads"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { byDue, mirrorItems } from "@/lib/notion/mirror"
import { notionWritesLive } from "@/lib/notion/server"
import { peopleForClient } from "@/lib/people"
import { cachedSprintNumbers, ensureSprint, loadSprintDetails, type Sprint, type SprintItem } from "@/lib/sprints/data"
import { suggestChanges } from "@/lib/sprints/detect"
import { sprintByNumber, sprintDay, sprintOf, SPRINT_DAYS } from "@/lib/sprints/periods"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { ChangeLog } from "./change-log"
import { CloseSprint } from "./close-sprint"
import { EditableText } from "./editable-text"
import { ItemList } from "./item-list"

export default async function SprintPage({ params, searchParams }: PageProps<"/clients/[slug]/sprint">) {
  const { slug } = await params
  const { n } = await searchParams
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([
    supabase.from("clients").select("id, currency, monthly_kpi_target").eq("slug", slug).maybeSingle(),
    getProfile(),
  ])
  if (!client) notFound()

  const today = londonToday()
  const current = sprintOf(today)
  const requested = typeof n === "string" && /^-?\d+$/.test(n) ? Number(n) : current.number
  if (requested > current.number) notFound()
  const period = requested === current.number ? current : sprintByNumber(requested)

  // The current sprint is created on first view; earlier ones only exist if someone used them.
  let sprint: Sprint | null
  if (requested === current.number) sprint = await ensureSprint(supabase, client.id, period)
  else {
    const { data } = await supabase.from("sprints").select("*").eq("client_id", client.id).eq("start_date", period.start).maybeSingle()
    sprint = data as Sprint | null
  }
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

  const [details, numbers, { data: runs }, actions, owners] = await Promise.all([
    loadSprintDetails(supabase, sprint),
    cachedSprintNumbers(client.id, period), // access confirmed: sprint loaded through RLS
    supabase
      .from("check_runs")
      .select("id, period_start, check_results(id, status, findings, notion_action_page_id, check_definitions(name))")
      .eq("client_id", client.id)
      .eq("cadence", "weekly")
      .gte("period_start", period.start)
      .lte("period_start", period.end),
    mirrorItems(supabase, client.id, "action"),
    peopleForClient(supabase, client.id),
  ])
  const { items, changes, history, previous } = details
  const { summary, events, detectionDaily } = numbers
  const closed = Boolean(sprint.closed_at)
  const readOnly = closed
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const cur = client.currency
  const shown = closed && sprint.summary ? sprint.summary : summary // closed sprints show their snapshot

  const byKind = (k: SprintItem["kind"]) => items.filter((i) => i.kind === k)
  const hypotheses = [...byKind("hypothesis"), ...byKind("carried").filter((i) => i.origin_kind === "hypothesis")]
  const knownKeys = new Set(changes.map((c) => c.detected_key).filter(Boolean))
  const detectTo = summary.dataThrough && summary.dataThrough < period.end ? summary.dataThrough : period.end
  const suggestions = closed ? [] : suggestChanges({ events, daily: detectionDaily, from: period.start, to: detectTo, currency: cur }).filter((s) => !knownKeys.has(s.key))
  const results = (runs ?? []).flatMap((r) => (r.check_results ?? []) as unknown as { id: string; status: string | null; findings: string | null; notion_action_page_id: string | null; check_definitions: { name: string } | null }[])
  const reds = results.filter((r) => r.status === "red")
  const checksDone = results.filter((r) => r.status !== null).length
  const openActions = actions.filter((a) => !a.closed).sort(byDue)
  const carryCount = items.filter((i) => i.carry_forward && i.status !== "dropped").length
  const day = sprintDay(period, today)
  const isCurrent = period.number === current.number

  return (
    <div className="space-y-12">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Sprint</p>
            <h2 className="mt-1 text-4xl">
              Sprint {period.number} <span className="text-muted-foreground">·</span>{" "}
              <span className="text-2xl">
                {longDate(period.start)} – {longDate(period.end)}
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
            <div className="h-full bg-ink" style={{ width: `${(day / SPRINT_DAYS) * 100}%` }} />
          </div>
        )}
        {isCurrent && previous && !previous.closed_at && (
          <p className="rounded-md border border-rag-amber/40 bg-rag-amber-bg px-3 py-2 text-sm text-rag-amber">
            Sprint {previous.number} hasn&apos;t been reviewed yet.{" "}
            <Link href={`/clients/${slug}/sprint?n=${previous.number}`} className="underline">
              Review and close it
            </Link>{" "}
            so its learnings carry into this sprint.
          </p>
        )}
      </header>

      {/* Numbers */}
      <section aria-label="Sprint numbers">
        {shown.dataThrough && shown.dataThrough < period.start && (
          <p className="mb-3 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
            No ad data for this sprint yet: Windsor data runs through {longDate(shown.dataThrough)} and syncs daily. Numbers appear from tomorrow.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Spend" value={money(shown.current.spend, cur)} change={pctChange(shown.current.spend, shown.previous.spend)} />
          <Stat label="Results" value={oneDp(shown.current.results)} change={pctChange(shown.current.results, shown.previous.results)} goodWhenUp />
          <Stat
            label="Cost per result"
            value={money(shown.current.costPerResult, cur)}
            change={pctChange(shown.current.costPerResult, shown.previous.costPerResult)}
            goodWhenDown
            note={target ? `Target ${money(target, cur)}` : undefined}
            status={target && shown.current.costPerResult !== null ? (shown.current.costPerResult <= target ? "green" : shown.current.costPerResult <= target * 1.2 ? "amber" : "red") : undefined}
          />
          <Stat label="Weekly checks done" value={`${checksDone}/${results.length || 0}`} note={`${(runs ?? []).length} of 2 weeks started`} />
          <Trend trend={shown.trend} current={period.number} currency={cur} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Change vs Sprint {period.number - 1} over the same number of days. {shown.dataThrough ? `Data through ${longDate(shown.dataThrough)}.` : ""} Result = conversions + leads.
        </p>
      </section>

      {/* 1. Plan */}
      <section className="space-y-4">
        <SectionTitle step="1" title="Plan" hint="What this sprint is for, and what you're testing." />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-2">
            <h3 className="eyebrow">Sprint goal</h3>
            <EditableText sprintId={sprint.id} field="goal" initial={sprint.goal} placeholder="e.g. Bring blended cost per result under $300" readOnly={readOnly} label="Sprint goal" />
          </div>
          <div className="space-y-2">
            <h3 className="eyebrow">Carried from Sprint {period.number - 1}</h3>
            <ItemList sprintId={sprint.id} kind="carried" items={byKind("carried")} readOnly={readOnly} showCarry emptyText="Nothing carried forward." />
          </div>
          <div className="space-y-2">
            <h3 className="eyebrow">Hypotheses to test</h3>
            <ItemList sprintId={sprint.id} kind="hypothesis" items={byKind("hypothesis")} readOnly={readOnly} showCarry addPlaceholder="If we…, then… because…" emptyText="No hypotheses yet." />
          </div>
        </div>
      </section>

      {/* 2. Change log */}
      <section className="space-y-4">
        <SectionTitle step="2" title="Change log" hint="Every change made during the sprint, so results can be traced back to it." />
        <ChangeLog
          sprintId={sprint.id}
          changes={changes}
          suggestions={suggestions}
          hypotheses={hypotheses}
          platforms={summary.byPlatform.map((p) => p.platform)}
          today={today < period.end ? today : period.end}
          readOnly={readOnly}
        />
      </section>

      {/* Actions */}
      <section className="space-y-4">
        <SectionTitle step="3" title="Actions" hint="Reds from this sprint's checks, and open actions in Notion." />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="eyebrow">Red checks this sprint</h3>
            {reds.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No reds.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {reds.map((r) => (
                  <li key={r.id} className="rounded-md border bg-card p-3">
                    <p className="font-bold">{r.check_definitions?.name}</p>
                    {r.findings && <p className="line-clamp-2 text-muted-foreground">{r.findings}</p>}
                    <Link href={`/clients/${slug}/checks?result=${r.id}#check-${r.id}`} className="text-xs underline">
                      {r.notion_action_page_id ? "Actioned in Notion: view check" : "Open the check to create an action"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <ItemList sprintId={sprint.id} kind="action" items={byKind("action")} readOnly={readOnly} showCarry addPlaceholder="Add a sprint to-do" emptyText="No sprint to-dos." />
          </div>
          <div className="space-y-2">
            <h3 className="eyebrow">Open actions in Notion</h3>
            {openActions.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">None.</p>
            ) : (
              <ul className="divide-y rounded-md border bg-card text-sm">
                {openActions.slice(0, 10).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="line-clamp-1 font-bold">{a.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.status} · {a.owners.join(", ") || "no owner"}
                        {a.due && ` · due ${longDate(a.due)}`}
                      </span>
                    </span>
                    <a href={a.url} target="_blank" rel="noreferrer" className="shrink-0 underline">
                      Open in Notion
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {!readOnly && (
              <details className="rounded-md border bg-card p-3">
                <summary className="cursor-pointer text-sm">New action in Notion</summary>
                <div className="mt-3">
                  <ActionForm
                    clientSlug={slug}
                    live={notionWritesLive()}
                    owners={owners.map((p) => ({ id: p.notionUserId, name: p.name, onTeam: p.onTeam }))}
                    defaults={{ title: "", ownerId: null, dueDate: addDays(today, 7), description: "" }}
                  />
                </div>
              </details>
            )}
          </div>
        </div>
      </section>

      {/* 4. Review board (after the Sprint Review Highlights layout) */}
      <section className="space-y-4">
        <SectionTitle step="4" title="Sprint review" hint="Fill in at the end of the sprint. Learnings and mitigations carry into the next one." />
        <div className="space-y-4 rounded-xl bg-ink p-4 text-white sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-heading text-2xl">Sprint {period.number} review</p>
            <p className="text-xs text-white/60">
              {longDate(period.start)} – {longDate(period.end)}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <span className="shrink-0 rounded-full bg-lime px-3 py-1 text-xs font-bold text-ink">Key takeaway</span>
            <div className="flex-1 text-ink [&_p]:text-white">
              <EditableText sprintId={sprint.id} field="key_takeaway" initial={sprint.key_takeaway} placeholder="The single most important learning from this sprint…" rows={2} readOnly={readOnly} label="Key takeaway" />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Box title="Highlights (work done + impact)" accent>
              <ul className="mb-3 space-y-1 text-xs text-muted-foreground">
                <li>
                  Spend {money(shown.current.spend, cur)} ({signedPct(pctChange(shown.current.spend, shown.previous.spend))}) · {oneDp(shown.current.results)} results · {money(shown.current.costPerResult, cur)} per result
                </li>
                {shown.byPlatform.map((p) => (
                  <li key={p.platform}>
                    {PLATFORM_LABEL[p.platform]}: {money(p.current.costPerResult, cur)} per result ({signedPct(pctChange(p.current.costPerResult, p.previous.costPerResult))} vs last sprint)
                  </li>
                ))}
                {shown.best.map((b) => (
                  <li key={b.platform}>
                    Best {PLATFORM_LABEL[b.platform]} ad: {b.name.slice(0, 60)} ({b.basis === "cost per result" ? `${money(Number(b.value), cur)} per result` : `${b.value} CTR`})
                  </li>
                ))}
                <li>{changes.filter((c) => c.status === "logged").length} changes logged</li>
              </ul>
              <EditableText sprintId={sprint.id} field="highlights" initial={sprint.highlights} placeholder="What was done and what it achieved…" readOnly={readOnly} label="Highlights" />
            </Box>
            <Box title="Top learnings">
              <ItemList sprintId={sprint.id} kind="learning" items={byKind("learning")} readOnly={readOnly} showCarry addPlaceholder="Add a learning" emptyText="No learnings yet." />
            </Box>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Box title="Challenge & hypotheses why">
              {hypotheses.length > 0 && (
                <ul className="mb-3 space-y-1 text-xs text-muted-foreground">
                  {hypotheses.map((h) => (
                    <li key={h.id}>
                      {h.outcome ? `${h.outcome[0].toUpperCase()}${h.outcome.slice(1)}: ` : "Untested: "}
                      {h.text}
                    </li>
                  ))}
                </ul>
              )}
              <EditableText sprintId={sprint.id} field="challenges" initial={sprint.challenges} placeholder="What got in the way, and why we think so…" readOnly={readOnly} label="Challenges" />
            </Box>
            <Box title="Mitigation plan">
              <ItemList sprintId={sprint.id} kind="mitigation" items={byKind("mitigation")} readOnly={readOnly} showCarry addPlaceholder="Add a mitigation" emptyText="No mitigations yet." />
            </Box>
            <Box title="Progress made">
              <EditableText sprintId={sprint.id} field="progress_made" initial={sprint.progress_made} placeholder="Progress towards the goal…" readOnly={readOnly} label="Progress made" />
            </Box>
          </div>
          <div className="pt-2 text-ink">
            <div className="rounded-md bg-card p-3">
              <CloseSprint sprintId={sprint.id} closed={closed} isAdmin={isAdmin(me)} carryCount={carryCount} />
            </div>
          </div>
        </div>
      </section>

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
                <span className="text-muted-foreground">
                  {h.closed_at ? `Closed · ${money(h.summary?.current.costPerResult ?? null, cur)} per result` : "Open"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/learnings" className="text-sm underline">
          All learnings across sprints →
        </Link>
      </section>
    </div>
  )
}

function SectionTitle({ step, title, hint }: { step: string; title: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm text-lime">{step}</span>
      <div>
        <h2 className="text-2xl">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

function Box({ title, accent, children }: { title: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg bg-card text-foreground">
      <p className={cn("px-4 py-2 text-sm font-bold", accent ? "bg-lime text-ink" : "bg-secondary")}>{title}</p>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Stat({ label, value, change, goodWhenUp, goodWhenDown, note, status }: { label: string; value: string; change?: number | null; goodWhenUp?: boolean; goodWhenDown?: boolean; note?: string; status?: "green" | "amber" | "red" }) {
  const good = change === null || change === undefined ? null : goodWhenDown ? change < 0 : goodWhenUp ? change > 0 : null
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-2xl tabular-nums">{value}</p>
      {change !== undefined && <p className={cn("text-xs", good === null ? "text-muted-foreground" : good ? "text-rag-green" : "text-rag-red")}>{signedPct(change ?? null)} vs last sprint</p>}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {status && <StatusBadge status={status} label={status === "green" ? "On target" : status === "amber" ? "Near target" : "Over target"} className="mt-1" />}
    </div>
  )
}

/** Cost per result by sprint (last six). Bars are relative to the highest. */
function Trend({ trend, current, currency }: { trend: { number: number; costPerResult: number | null; results: number }[]; current: number; currency: string }) {
  const max = Math.max(...trend.map((t) => t.costPerResult ?? 0), 1)
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">Cost per result by sprint</p>
      <div className="mt-2 flex h-16 items-end gap-1.5" role="img" aria-label={trend.map((t) => `Sprint ${t.number}: ${t.costPerResult === null ? "no results" : money(t.costPerResult, currency)}`).join(", ")}>
        {trend.map((t) => (
          <div key={t.number} className="flex flex-1 flex-col items-center gap-1" title={`Sprint ${t.number}: ${t.costPerResult === null ? "no results" : money(t.costPerResult, currency)}`}>
            <div className={cn("w-full rounded-sm", t.number === current ? "bg-ink" : "bg-violet/60")} style={{ height: `${t.costPerResult ? Math.max((t.costPerResult / max) * 48, 3) : 2}px` }} />
            <span className="text-[10px] text-muted-foreground">{t.number}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

