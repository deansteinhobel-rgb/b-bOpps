"use client"

import { ArrowRightLeft, Check, ChevronRight, ExternalLink, Link2, Pencil, Target, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition } from "react"
import { Avatar, PlatformLabel } from "@/components/brand"
import { fieldClass } from "@/components/field-class"
import { Sparkle } from "@/components/fx/sparkle"
import { Hint } from "@/components/hint"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { longDate, money, oneDp } from "@/lib/format"
import type { BriefInfo, Campaign } from "@/lib/sprints/board"
import type { SprintTest } from "@/lib/sprints/data"
import type { PreviewMap } from "@/lib/previews"
import { TEST_KINDS, type TestDetail, type TestKind } from "@/lib/sprints/results"
import { daysSince, dueChip } from "@/lib/sprints/stage-style"
import { ASSETS, CARRY_REASONS, evaluate, METRICS, type Stage, type TestTotals } from "@/lib/sprints/tests"
import { cn } from "@/lib/utils"
import { BriefDialog } from "./brief-form"
import { clearOutcome, markLive, markReadyManually, renameTest, saveFindings, setOutcome } from "./test-actions"
import { TestPanel, VerdictChip } from "./test-panel"

const OUTCOME = {
  proven: { label: "Proven", rag: "green" },
  disproven: { label: "Disproven", rag: "red" },
  inconclusive: { label: "Inconclusive", rag: "na" },
  carried: { label: "Carried over", rag: "amber" },
} as const

type Fmt = (v: number | null) => string

/** Formats a value in the success metric's unit. */
function metricFormat(metric: string | null, m: (v: number) => string): Fmt {
  const unit = metric ? METRICS[metric]?.unit : undefined
  return (v) => (v === null ? "–" : unit === "money" ? m(v) : unit === "percent" ? `${v.toFixed(2)}%` : oneDp(v))
}

/**
 * A test on the sprint board (Dean, 2026-09-30: easier to scan). Top to bottom: platform and due
 * date, the title, the goal, then one panel for where it is now, and one next step in the footer.
 * Rules and long explanations sit behind hints; the stage colour lives on the column.
 */
export function TestCard(props: {
  test: SprintTest
  stage: Stage
  brief?: BriefInfo
  results?: TestTotals
  campaigns: Campaign[]
  currency: string
  readOnly: boolean
  writesLive: boolean
  today: string
  /** Live results for the side panel (live and review tests with campaigns). */
  detail?: TestDetail
  previews?: PreviewMap
  /** Admins and GTM leads can rename the test (Dean, 2026-09-30). */
  canRename?: boolean
}) {
  const { test: t, stage } = props
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [panel, setPanel] = useState<null | "live" | "findings" | "carry">(null)
  // The results panel is in the URL (?test=<id>), so a link opens it.
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const resultsOpen = Boolean(props.detail) && params.get("test") === t.id
  const setResultsOpen = (open: boolean) => {
    const next = new URLSearchParams(params.toString())
    if (open) next.set("test", t.id)
    else next.delete("test")
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
  }
  const m = (v: number) => money(v, props.currency)
  const fmt = metricFormat(t.success_metric, m)
  const def = t.success_metric ? METRICS[t.success_metric] : undefined
  const due = stage === "planned" || stage === "in_production" || stage === "ready" ? dueChip(t.deadline, props.today) : null
  const editable = !props.readOnly
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn()
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.message ?? "Something went wrong." })
      if (r.ok) after?.()
    })
  const openLive = () => setPanel("live")
  const submitLive = (live_on: string, campaigns: { id: string; name: string }[], kind: TestKind | null) => run(() => markLive(t.id, { live_on, campaigns, kind }), () => setPanel(null))
  const tags = [
    t.carried_from_test_id && <CarriedTag key="c" />,
    t.recommendation_id && <PourTag key="p" />,
    t.insight_key && <OptimiseTag key="o" />,
    t.content_idea_id && <ContentIdeaTag key="i" />,
    t.call_commitment_id && <CallTag key="c" />,
  ].filter(Boolean)

  // The one next step for this stage, shown in the footer.
  let primary: React.ReactNode = null
  if (editable && panel === null) {
    if (stage === "planned")
      primary = (
        <>
          {!props.writesLive && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => markReadyManually(t.id))} title="Test mode: skip Notion and treat the assets as ready">
              Mark ready
            </Button>
          )}
          <BriefDialog testId={t.id} live={props.writesLive} disabled={pending} onDone={(r) => setMsg({ ok: r.ok, text: r.text })} />
        </>
      )
    else if (stage === "in_production" && !t.notion_page_id)
      primary = (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markReadyManually(t.id))}>
          Mark ready
        </Button>
      )
    else if (stage === "ready")
      primary = (
        <Button size="sm" onClick={openLive}>
          Mark live
        </Button>
      )
    else if (stage === "live" && t.campaign_ids?.length)
      primary = props.detail ? (
        <Button size="sm" onClick={() => setResultsOpen(true)}>
          View results
        </Button>
      ) : (
        <Button size="sm" onClick={() => setPanel("findings")}>
          Add findings
        </Button>
      )
  }

  return (
    <article id={`test-${t.id}`} className="scroll-mt-6 overflow-hidden rounded-xl border bg-card text-sm transition-colors hover:border-foreground/20">
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <PlatformLabel platform={t.platform} className="min-w-0 truncate text-xs text-muted-foreground" />
          {due && (
            <span title={due.title} className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1", due.tone)}>
              {due.text}
            </span>
          )}
          {stage === "live" && t.live_on && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rag-green-bg px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-rag-green ring-1 ring-rag-green/30" title={`Live since ${longDate(t.live_on)}`}>
              <span className="size-1.5 animate-pulse rounded-full bg-rag-green motion-reduce:animate-none" aria-hidden />
              Live · day {Math.max(1, daysSince(t.live_on, props.today) + 1)}
            </span>
          )}
        </div>

        <TestTitle
          testId={t.id}
          title={t.title}
          canRename={props.canRename ?? false}
          onOpen={props.detail ? () => setResultsOpen(true) : undefined}
        />

        <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" title={t.owner_name ? `Owner: ${t.owner_name}` : "No owner"}>
          <Avatar name={t.owner_name ?? "?"} className="size-5 text-[9px]" />
          <span className="truncate">{t.owner_name ?? "No owner"}</span>
        </p>

        {tags.length > 0 && <div className="flex flex-wrap gap-1.5">{tags}</div>}

        <Goal test={t} fmt={fmt} />

        {stage === "planned" && t.assets.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {t.assets.map((a) => (
              <span key={a} className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {ASSETS[a] ?? a}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Where it is now */}
      {stage === "in_production" && (
        <Panel>
          <div className="flex flex-wrap items-center gap-1.5">
            <NotionPill label="Notion" value={props.brief?.status ?? "Not synced yet"} />
            {props.brief?.paid && <NotionPill label="Paid" value={props.brief.paid} />}
            <Hint label="When does it move on?">
              Ready to launch when Status Paid is Ready for Build or Master Status is Client Approved. Live when it&apos;s Production Complete or Gone Live. The board follows Notion every hour.
            </Hint>
          </div>
        </Panel>
      )}

      {(stage === "ready" || stage === "review" || stage === "done") && props.brief && (
        <Panel>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase">What we created</p>
            <NotionLink href={props.brief.url} />
          </div>
          {props.brief.links.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {props.brief.links.map((l, i) => (
                <li key={i} className="max-w-full">
                  {l.href ? (
                    <a href={l.href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs hover:bg-elevated" title={`${l.label}: ${l.text}`}>
                      <Link2 className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{l.label}</span>
                    </a>
                  ) : (
                    <span className="inline-flex rounded-md bg-secondary px-2 py-1 text-xs" title={l.text}>
                      {l.label}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No links on the brief yet.</p>
          )}
        </Panel>
      )}

      {stage === "live" && !t.campaign_ids?.length && (
        <Panel className="bg-rag-amber-bg">
          <p className="text-xs">
            <span className="font-medium text-rag-amber">Which campaigns is it running in?</span> Pick them so the app can measure it.
          </p>
          {editable && panel !== "live" && (
            <Button size="sm" onClick={openLive}>
              Pick the campaigns
            </Button>
          )}
        </Panel>
      )}

      {(stage === "live" || stage === "review" || stage === "done") && t.live_on && t.campaign_ids.length > 0 && (
        <Panel>
          {props.detail && (
            <button type="button" onClick={() => setResultsOpen(true)} className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-secondary" title="Open the results">
              <VerdictChip kind={props.detail.verdict.kind} />
              <span className="line-clamp-2 min-w-0 flex-1 text-[11px] text-muted-foreground">{props.detail.verdict.reason}</span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          )}
          <Results test={t} results={props.results} money={m} fmt={fmt} label={def?.label} />
        </Panel>
      )}

      {stage === "done" && t.outcome && (
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={OUTCOME[t.outcome].rag} label={OUTCOME[t.outcome].label} />
            {t.outcome === "carried" && (
              <span className="text-xs text-muted-foreground">
                {CARRY_REASONS[t.carry_reason ?? "other"]}
                {t.carry_note ? `: ${t.carry_note}` : ""}
              </span>
            )}
          </div>
          <FindingsView test={t} />
        </Panel>
      )}

      {/* Forms open in place */}
      {editable && panel === "live" && (
        <Panel>
          <MarkLive campaigns={props.campaigns} today={t.live_on ?? props.today} pending={pending} onCancel={() => setPanel(null)} onSubmit={submitLive} />
        </Panel>
      )}
      {editable && stage !== "done" && (panel === "findings" || stage === "review") && (
        <Panel>
          <Findings test={t} pending={pending} onSave={(f) => run(() => saveFindings(t.id, f), () => setPanel(null))} />
        </Panel>
      )}
      {editable && stage === "review" && (
        <Panel>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Call it</p>
          <div className="flex flex-wrap gap-2">
            {(["proven", "disproven", "inconclusive"] as const).map((o) => (
              <Button key={o} size="sm" variant="outline" disabled={pending} onClick={() => run(() => setOutcome(t.id, { outcome: o, carry_reason: null }))}>
                <span aria-hidden className={cn("size-1.5 rounded-full", o === "proven" ? "bg-rag-green" : o === "disproven" ? "bg-rag-red" : "bg-rag-na")} />
                {OUTCOME[o].label}
              </Button>
            ))}
          </div>
        </Panel>
      )}
      {editable && panel === "carry" && (
        <Panel>
          <CarryOver
            pending={pending}
            onCancel={() => setPanel(null)}
            onSubmit={(reason, note) => run(() => setOutcome(t.id, { outcome: "carried", carry_reason: reason as "deadline", carry_note: note }), () => setPanel(null))}
          />
        </Panel>
      )}

      {msg && (
        <p className={cn("border-t px-4 py-2 text-xs", msg.ok ? "text-rag-green" : "text-rag-red")} role="status">
          {msg.text}
        </p>
      )}

      {editable && (
        <footer className="flex items-center gap-2 border-t px-3 py-2">
          {stage === "in_production" && props.brief && (
            <span className="pl-1">
              <NotionLink href={props.brief.url} />
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {primary}
            {stage !== "done" && panel !== "carry" && (
              <Button size="icon-sm" variant="ghost" onClick={() => setPanel("carry")} title="Carry over to next sprint" aria-label="Carry over to next sprint" className="text-muted-foreground">
                <ArrowRightLeft className="size-3.5" aria-hidden />
              </Button>
            )}
            {stage === "done" && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" disabled={pending} onClick={() => run(() => clearOutcome(t.id))}>
                Undo outcome
              </button>
            )}
          </div>
        </footer>
      )}
      {props.detail && (
        <TestPanel
          open={resultsOpen}
          onOpenChange={setResultsOpen}
          test={t}
          detail={props.detail}
          previews={props.previews ?? {}}
          currency={props.currency}
          editable={editable}
          today={props.today}
          onAddFindings={
            stage === "live"
              ? () => {
                  setResultsOpen(false)
                  setPanel("findings")
                }
              : undefined
          }
        />
      )}
    </article>
  )
}

/** The test's name. Admins see a pencil on hover and rename it in place (Enter saves, Esc cancels). */
function TestTitle({ testId, title, canRename, onOpen }: { testId: string; title: string; canRename: boolean; onOpen?: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const cancel = () => {
    setValue(title)
    setError(null)
    setEditing(false)
  }
  const save = () => {
    const next = value.trim()
    if (!next || next === title) return cancel()
    start(async () => {
      const r = await renameTest(testId, next)
      if (r.ok) setEditing(false)
      else setError(r.message ?? "Couldn't save the name.")
    })
  }
  if (editing)
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-1">
          <Textarea
            autoFocus
            aria-label="Test name"
            rows={2}
            maxLength={200}
            value={value}
            disabled={pending}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                save()
              }
              if (e.key === "Escape") cancel()
            }}
            className="min-h-0 resize-none bg-background text-[15px] leading-snug font-semibold"
          />
          <div className="flex flex-col gap-0.5">
            <Button size="icon-xs" variant="ghost" disabled={pending} onClick={save} aria-label="Save the name" title="Save (Enter)">
              <Check aria-hidden />
            </Button>
            <Button size="icon-xs" variant="ghost" disabled={pending} onClick={cancel} aria-label="Cancel" title="Cancel (Esc)">
              <X aria-hidden />
            </Button>
          </div>
        </div>
        {error && (
          <p className="text-xs text-rag-red" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  return (
    <div className="group/title flex items-start gap-1">
      <h3 className="line-clamp-3 min-w-0 flex-1 text-[15px] leading-snug font-semibold text-balance" title={title}>
        {onOpen ? (
          <button type="button" className="text-left hover:underline focus-visible:underline focus-visible:outline-none" onClick={onOpen}>
            {title}
          </button>
        ) : (
          title
        )}
      </h3>
      {canRename && (
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => {
            setValue(title)
            setEditing(true)
          }}
          aria-label="Rename the test"
          title="Rename"
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100 max-lg:opacity-100"
        >
          <Pencil aria-hidden />
        </Button>
      )}
    </div>
  )
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-2 border-t bg-elevated/40 px-4 py-3", className)}>{children}</div>
}

/** The success goal: the measurable target as a chip, the words under it. */
function Goal({ test: t, fmt }: { test: SprintTest; fmt: Fmt }) {
  const def = t.success_metric ? METRICS[t.success_metric] : undefined
  const hasTarget = Boolean(def) && t.success_target !== null
  if (!hasTarget && !t.success_text) return <p className="text-xs text-muted-foreground italic">No success measure set</p>
  return (
    <div className="space-y-1.5">
      {def && hasTarget && (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs">
          <Target className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{def.label}</span>
          <strong className="font-semibold">
            {def.lowerIsBetter ? "≤" : "≥"} {fmt(t.success_target)}
          </strong>
        </p>
      )}
      {t.success_text && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={t.success_text}>
          {!hasTarget && <Target className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />}
          {t.success_text}
        </p>
      )}
    </div>
  )
}

function NotionPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-lavender/10 px-2 py-0.5 text-[11px] ring-1 ring-lavender/25">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-lavender">{value}</span>
    </span>
  )
}

function NotionLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title="Open the brief in Notion" className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline">
      Notion brief <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}

function CarriedTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rag-amber/35 bg-rag-amber-bg px-2 py-0.5 text-[11px] font-medium text-rag-amber" title="Carried over from the last sprint">
      <ArrowRightLeft className="size-3" aria-hidden />
      Carried over
    </span>
  )
}

function MarkLive({ campaigns, today, pending, onSubmit, onCancel }: { campaigns: Campaign[]; today: string; pending: boolean; onSubmit: (liveOn: string, c: { id: string; name: string }[], kind: TestKind | null) => void; onCancel: () => void }) {
  const [liveOn, setLiveOn] = useState(today)
  const [kind, setKind] = useState<TestKind | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [filter, setFilter] = useState("")
  const shown = campaigns.filter((c) => !filter || c.campaign_name.toLowerCase().includes(filter.toLowerCase())).slice(0, 25)
  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="space-y-1">
        <Label htmlFor="live-on">Live from</Label>
        <Input id="live-on" type="date" value={liveOn} onChange={(e) => setLiveOn(e.target.value)} />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs">What kind of test is it?</legend>
        <div className="grid gap-1.5">
          {(Object.keys(TEST_KINDS) as TestKind[]).map((k) => (
            <label key={k} className={cn("flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs", kind === k && "border-lime/60 bg-lime/5")}>
              <input type="radio" name="test-kind" className="mt-0.5" checked={kind === k} onChange={() => setKind(k)} />
              <span>
                <span className="font-medium">{TEST_KINDS[k].label}</span>
                <span className="block text-[11px] text-muted-foreground">{TEST_KINDS[k].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <p className="text-xs">Which campaigns is it running in? (so the app can measure it)</p>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter campaigns…" aria-label="Filter campaigns" />
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {shown.map((c) => (
            <li key={c.campaign_id}>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={chosen.includes(c.campaign_id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, c.campaign_id] : chosen.filter((x) => x !== c.campaign_id))} />
                <span>{c.campaign_name}</span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="text-xs text-muted-foreground italic">No campaigns with spend in the last 30 days. New campaigns appear after the next Windsor sync.</li>}
        </ul>
      </div>
      <div className="flex gap-2">
        <Sparkle>
          <Button size="sm" disabled={pending} onClick={() => onSubmit(liveOn, campaigns.filter((c) => chosen.includes(c.campaign_id)).map((c) => ({ id: c.campaign_id, name: c.campaign_name })), kind)}>
            It&apos;s live
          </Button>
        </Sparkle>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Live results: the success metric big and coloured against its target, then spend, results and clicks. */
function Results({ test: t, results, money, fmt, label }: { test: SprintTest; results?: TestTotals; money: (v: number) => string; fmt: Fmt; label?: string }) {
  const ev = results ? evaluate(t.success_metric, t.success_target, results) : null
  const def = t.success_metric ? METRICS[t.success_metric] : undefined
  if (!results || results.days === 0) return <p className="text-xs text-muted-foreground">No data yet. Windsor syncs daily.</p>
  const gap = ev?.value != null && t.success_target ? Math.round(((ev.value - t.success_target) / t.success_target) * 100) : null
  const tone = ev?.meets === true ? "text-rag-green" : ev?.meets === false ? "text-rag-red" : "text-foreground"
  return (
    <div className="space-y-3">
      {def && (
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className={cn("text-2xl leading-tight font-semibold tabular-nums", tone)}>{fmt(ev?.value ?? null)}</p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <p>target {fmt(t.success_target)}</p>
            {gap !== null && gap !== 0 && (
              <p className={tone}>
                {Math.abs(gap)}% {gap > 0 ? "above" : "below"}
              </p>
            )}
          </div>
        </div>
      )}
      <dl className="grid grid-cols-3 gap-2 text-xs">
        {[
          ["Spend", money(results.spend)],
          ["Results", oneDp(ev?.results ?? 0)],
          ["Clicks", String(results.clicks)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md bg-secondary px-2 py-1.5">
            <dt className="text-[10px] text-muted-foreground">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-muted-foreground" title={t.campaign_names.join("\n")}>
        {results.days} day{results.days === 1 ? "" : "s"} of data{results.data_through ? ` to ${longDate(results.data_through)}` : ""} · {t.campaign_names.length} campaign{t.campaign_names.length === 1 ? "" : "s"}
      </p>
    </div>
  )
}

function Findings({ test, pending, onSave }: { test: SprintTest; pending: boolean; onSave: (f: { worked: string; blockers: string; notes: string }) => void }) {
  const [f, setF] = useState({ worked: test.findings_worked ?? "", blockers: test.findings_blockers ?? "", notes: test.findings_notes ?? "" })
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={`w-${test.id}`}>What worked</Label>
        <Textarea id={`w-${test.id}`} rows={2} value={f.worked} onChange={(e) => setF({ ...f, worked: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`b-${test.id}`}>What was the blocker</Label>
        <Textarea id={`b-${test.id}`} rows={2} value={f.blockers} onChange={(e) => setF({ ...f, blockers: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`n-${test.id}`}>Other notes</Label>
        <Textarea id={`n-${test.id}`} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => onSave(f)}>
        Save findings
      </Button>
    </div>
  )
}

function FindingsView({ test: t }: { test: SprintTest }) {
  if (!t.findings_worked && !t.findings_blockers && !t.findings_notes) return null
  return (
    <dl className="space-y-1 text-xs">
      {t.findings_worked && (
        <div>
          <dt className="text-muted-foreground">What worked</dt>
          <dd className="whitespace-pre-line">{t.findings_worked}</dd>
        </div>
      )}
      {t.findings_blockers && (
        <div>
          <dt className="text-muted-foreground">Blocker</dt>
          <dd className="whitespace-pre-line">{t.findings_blockers}</dd>
        </div>
      )}
      {t.findings_notes && (
        <div>
          <dt className="text-muted-foreground">Notes</dt>
          <dd className="whitespace-pre-line">{t.findings_notes}</dd>
        </div>
      )}
    </dl>
  )
}

function CarryOver({ pending, onSubmit, onCancel }: { pending: boolean; onSubmit: (reason: string, note: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("deadline")
  const [note, setNote] = useState("")
  return (
    <div className="space-y-2 rounded-md border p-2">
      <Label htmlFor="carry-reason">Why is it carrying over?</Label>
      <select id="carry-reason" className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)}>
        {Object.entries(CARRY_REASONS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to add (optional)" aria-label="Carry-over note" />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => onSubmit(reason, note)}>
          Carry over
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Green tag for tests that came from an approved "Pour a Sprint" suggestion. */
export function PourTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-rag-green/35 bg-rag-green/10 px-2 py-0.5 text-[11px] font-medium text-rag-green", className)} title="Suggested by Pour a Sprint and approved by the team">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="size-3" aria-hidden>
        <path d="M4.5 1.5h7c0 3.6-1.3 6-3.5 6s-3.5-2.4-3.5-6Z" />
        <path d="M8 7.5v5.5M5.5 14.5h5" />
      </svg>
      Pour a Sprint suggestion
    </span>
  )
}

/** Tag for tests made from an "Optimise now" insight. */
export function ContentIdeaTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-lavender/40 bg-lavender/10 px-2 py-0.5 text-[11px] font-medium text-lavender", className)} title="Planned from a content idea on At a glance">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden>
        <path d="M8 1.5a4.5 4.5 0 0 0-2.5 8.2V12h5V9.7A4.5 4.5 0 0 0 8 1.5ZM6 14.5h4" />
      </svg>
      Content idea
    </span>
  )
}

export function OptimiseTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 text-[11px] font-medium text-violet", className)} title="Made from an Optimise now insight">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden>
        <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" />
      </svg>
      Optimise now
    </span>
  )
}

export function CallTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-[#f0a6ca]/40 bg-[#f0a6ca]/10 px-2 py-0.5 text-[11px] font-medium text-[#f0a6ca]", className)} title="Planned from something said on a client call">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden>
        <path d="M3 2.5h2.5l1 3-1.5 1a7 7 0 0 0 4.5 4.5l1-1.5 3 1V13a1 1 0 0 1-1 1A11 11 0 0 1 2 3.5a1 1 0 0 1 1-1Z" />
      </svg>
      From a call
    </span>
  )
}
