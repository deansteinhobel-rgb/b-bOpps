"use client"

import { useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { PlatformLabel } from "@/components/brand"
import { Sparkle } from "@/components/fx/sparkle"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { longDate, money, oneDp } from "@/lib/format"
import type { BriefInfo, Campaign } from "@/lib/sprints/board"
import type { SprintTest } from "@/lib/sprints/data"
import { ASSETS, CARRY_REASONS, evaluate, METRICS, successLine, type Stage, type TestTotals } from "@/lib/sprints/tests"
import { cn } from "@/lib/utils"
import { briefTest, clearOutcome, markLive, markReadyManually, saveFindings, setOutcome } from "./test-actions"

const OUTCOME = {
  proven: { label: "Proven", rag: "green" },
  disproven: { label: "Disproven", rag: "red" },
  inconclusive: { label: "Inconclusive", rag: "na" },
  carried: { label: "Carried over", rag: "amber" },
} as const

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
}) {
  const { test: t, stage } = props
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [panel, setPanel] = useState<null | "live" | "findings" | "carry">(null)
  const m = (v: number) => money(v, props.currency)
  const overdue = t.deadline && t.deadline < props.today && (stage === "planned" || stage === "in_production")
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn()
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.message ?? "Something went wrong." })
      if (r.ok) after?.()
    })

  return (
    <article id={`test-${t.id}`} className="scroll-mt-6 space-y-3 rounded-lg border bg-card p-4 text-sm">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <PlatformLabel platform={t.platform} className="text-foreground" />
          {t.carried_from_test_id && <span>Carried from last sprint</span>}
          {t.recommendation_id && <PourTag />}
          {t.insight_key && <OptimiseTag />}
          {t.content_idea_id && <ContentIdeaTag />}
        </div>
        <h3 className="text-base leading-snug font-bold">{t.title}</h3>
        <p className="text-xs text-muted-foreground">
          {t.owner_name ?? "No owner"}
          {t.deadline && (
            <>
              {" "}
              · <span className={cn(overdue && "font-bold text-rag-red")}>due {longDate(t.deadline)}</span>
            </>
          )}
        </p>
        <p className="text-xs">
          <span className="text-muted-foreground">Success: </span>
          {successLine(t.success_metric, t.success_target, t.success_text, m)}
        </p>
      </header>

      {/* Planned */}
      {stage === "planned" && (
        <div className="space-y-2">
          {t.assets.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {t.assets.map((a) => (
                <span key={a} className="rounded-full border px-2 py-0.5 text-xs">
                  {ASSETS[a] ?? a}
                </span>
              ))}
            </div>
          )}
          {!props.readOnly && (
            <div className="flex flex-wrap gap-2">
              <Sparkle>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await briefTest(t.id)
                    if (r.dryRun) setPreview((r.payload as { properties: Record<string, unknown> }).properties)
                    setMsg({ ok: r.ok, text: r.message ?? (r.ok ? "Done" : "Couldn't brief.") })
                  })
                }
              >
                {pending ? "Working…" : props.writesLive ? "Brief the team in Notion" : "Test: preview the Notion brief"}
              </Button>
              </Sparkle>
              {!props.writesLive && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markReadyManually(t.id))} title="Test mode: skip Notion and treat the assets as ready">
                  Mark ready (test mode)
                </Button>
              )}
            </div>
          )}
          {preview && <BriefPreview properties={preview} />}
        </div>
      )}

      {/* In production */}
      {stage === "in_production" && (
        <div className="space-y-1 rounded-md bg-secondary/60 p-2 text-xs">
          <p>
            Notion: <strong>{props.brief?.status ?? "not synced yet"}</strong>. Ready to launch once it&apos;s Client Approved or Production Complete.
          </p>
          {props.brief && (
            <a href={props.brief.url} target="_blank" rel="noreferrer" className="underline">
              Open the brief in Notion
            </a>
          )}
          {!t.notion_page_id && !props.readOnly && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markReadyManually(t.id))}>
              Mark ready
            </Button>
          )}
        </div>
      )}

      {/* What we created (from the Notion brief) */}
      {(stage === "ready" || stage === "live" || stage === "review" || stage === "done") && props.brief && (
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            What we created ·{" "}
            <a href={props.brief.url} target="_blank" rel="noreferrer" className="underline">
              brief in Notion
            </a>
          </p>
          {props.brief.links.length ? (
            <ul className="flex flex-wrap gap-2">
              {props.brief.links.map((l, i) => (
                <li key={i}>
                  {l.href ? (
                    <a href={l.href} target="_blank" rel="noreferrer" className="rounded-full border px-2 py-0.5 underline-offset-2 hover:underline">
                      {l.label}: {l.text}
                    </a>
                  ) : (
                    <span className="rounded-full border px-2 py-0.5">
                      {l.label}: {l.text}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground italic">No links on the brief yet (Figma board, campaign folder, useful links).</p>
          )}
        </div>
      )}

      {/* Ready to launch */}
      {stage === "ready" && !props.readOnly && (
        <div className="space-y-2">
          {panel === "live" ? (
            <MarkLive campaigns={props.campaigns} today={props.today} pending={pending} onCancel={() => setPanel(null)} onSubmit={(live_on, campaigns) => run(() => markLive(t.id, { live_on, campaigns }), () => setPanel(null))} />
          ) : (
            <Button size="sm" onClick={() => setPanel("live")}>
              Mark live
            </Button>
          )}
        </div>
      )}

      {/* Live / review: results */}
      {(stage === "live" || stage === "review" || stage === "done") && t.live_on && (
        <Results test={t} results={props.results} money={m} />
      )}
      {stage === "live" && !props.readOnly && panel !== "findings" && (
        <Button size="sm" onClick={() => setPanel("findings")}>
          Add findings
        </Button>
      )}
      {(panel === "findings" || stage === "review") && !props.readOnly && stage !== "done" && (
        <Findings test={t} pending={pending} onSave={(f) => run(() => saveFindings(t.id, f), () => setPanel(null))} />
      )}

      {/* Review: outcome */}
      {stage === "review" && !props.readOnly && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Outcome</p>
          <div className="flex flex-wrap gap-2">
            {(["proven", "disproven", "inconclusive"] as const).map((o) => (
              <Button key={o} size="sm" variant="outline" disabled={pending} onClick={() => run(() => setOutcome(t.id, { outcome: o, carry_reason: null }))}>
                {OUTCOME[o].label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Done */}
      {stage === "done" && t.outcome && (
        <div className="space-y-1">
          <StatusBadge status={OUTCOME[t.outcome].rag} label={OUTCOME[t.outcome].label} />
          {t.outcome === "carried" && (
            <p className="text-xs text-muted-foreground">
              {CARRY_REASONS[t.carry_reason ?? "other"]}
              {t.carry_note ? `: ${t.carry_note}` : ""}
            </p>
          )}
          <FindingsView test={t} />
          {!props.readOnly && (
            <button type="button" className="text-xs text-muted-foreground underline" disabled={pending} onClick={() => run(() => clearOutcome(t.id))}>
              Undo outcome
            </button>
          )}
        </div>
      )}

      {/* Carry over: possible at any stage until there's an outcome */}
      {stage !== "done" && !props.readOnly && (
        <div>
          {panel === "carry" ? (
            <CarryOver pending={pending} onCancel={() => setPanel(null)} onSubmit={(reason, note) => run(() => setOutcome(t.id, { outcome: "carried", carry_reason: reason as "deadline", carry_note: note }), () => setPanel(null))} />
          ) : (
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setPanel("carry")}>
              Carry over to next sprint
            </button>
          )}
        </div>
      )}
      {msg && (
        <p className={cn("text-xs", msg.ok ? "text-rag-green" : "text-rag-red")} role="status">
          {msg.text}
        </p>
      )}
    </article>
  )
}

function BriefPreview({ properties }: { properties: Record<string, unknown> }) {
  const text = (v: unknown): string => {
    const o = v as Record<string, unknown>
    if ("title" in o || "rich_text" in o) return ((o.title ?? o.rich_text) as { text: { content: string } }[]).map((x) => x.text.content).join("")
    if ("select" in o) return (o.select as { name: string }).name
    if ("status" in o) return (o.status as { name: string }).name
    if ("date" in o) return (o.date as { start: string }).start
    if ("url" in o) return String(o.url)
    if ("people" in o) return "Owner (Notion user)"
    return ""
  }
  return (
    <div className="rounded-md border border-dashed p-2 text-xs">
      <p className="mb-1 text-muted-foreground">The Notion brief that would be created:</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        {Object.entries(properties).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words whitespace-pre-line">{text(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function MarkLive({ campaigns, today, pending, onSubmit, onCancel }: { campaigns: Campaign[]; today: string; pending: boolean; onSubmit: (liveOn: string, c: { id: string; name: string }[]) => void; onCancel: () => void }) {
  const [liveOn, setLiveOn] = useState(today)
  const [chosen, setChosen] = useState<string[]>([])
  const [filter, setFilter] = useState("")
  const shown = campaigns.filter((c) => !filter || c.campaign_name.toLowerCase().includes(filter.toLowerCase())).slice(0, 25)
  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="space-y-1">
        <Label htmlFor="live-on">Live from</Label>
        <Input id="live-on" type="date" value={liveOn} onChange={(e) => setLiveOn(e.target.value)} />
      </div>
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
          <Button size="sm" disabled={pending} onClick={() => onSubmit(liveOn, campaigns.filter((c) => chosen.includes(c.campaign_id)).map((c) => ({ id: c.campaign_id, name: c.campaign_name })))}>
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

function Results({ test: t, results, money }: { test: SprintTest; results?: TestTotals; money: (v: number) => string }) {
  const ev = results ? evaluate(t.success_metric, t.success_target, results) : null
  const def = t.success_metric ? METRICS[t.success_metric] : undefined
  const fmt = (v: number | null) => (v === null ? "–" : def?.unit === "money" ? money(v) : def?.unit === "percent" ? `${v.toFixed(2)}%` : oneDp(v))
  return (
    <div className="space-y-1 rounded-md bg-secondary/60 p-2 text-xs">
      <p>
        Live since {longDate(t.live_on!)}
        {results?.days ? ` · ${results.days} day${results.days === 1 ? "" : "s"} of data${results.data_through ? ` (through ${longDate(results.data_through)})` : ""}` : ""}
      </p>
      {t.campaign_ids.length === 0 ? (
        <p className="text-muted-foreground">No campaigns linked, so results can&apos;t be measured automatically.</p>
      ) : !results || results.days === 0 ? (
        <p className="text-muted-foreground">No data yet. Windsor syncs daily.</p>
      ) : (
        <>
          <p>
            {money(results.spend)} spend · {oneDp(ev?.results ?? 0)} results · {results.clicks} clicks
          </p>
          {def && (
            <p className="flex items-center gap-2">
              {def.label}: <strong>{fmt(ev?.value ?? null)}</strong> vs target {fmt(t.success_target)}
              {ev?.meets !== null && ev?.meets !== undefined && <StatusBadge status={ev.meets ? "green" : "red"} label={ev.meets ? "On target" : "Not yet"} />}
            </p>
          )}
        </>
      )}
      {t.campaign_names.length > 0 && <p className="line-clamp-2 text-muted-foreground">Campaigns: {t.campaign_names.join("; ")}</p>}
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
