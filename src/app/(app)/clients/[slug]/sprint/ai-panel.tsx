"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { fieldClass } from "@/components/admin-form"
import { PlatformLabel } from "@/components/brand"
import { Sparkle } from "@/components/fx/sparkle"
import { WinePour } from "@/components/fx/wine-pour"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { money } from "@/lib/format"
import type { Platform } from "@/lib/metrics/types"
import { ASSETS, METRICS, successLine } from "@/lib/sprints/tests"
import { cn } from "@/lib/utils"
import { approveRecommendation, rejectRecommendation, reviewRecommendation } from "./ai-actions"
import type { Owner } from "./plan-test-form"

export type AiRun = { id: string; status: "generating" | "ready" | "failed"; created_at: string; market_summary: string | null; news: NewsItem[]; error: string | null }
type NewsItem = { platform: string; headline: string; detail: string; date?: string; url: string }
export type Recommendation = {
  id: string
  status: "draft" | "reviewed" | "approved" | "rejected"
  platform: string
  title: string
  hypothesis: string | null
  assets: string[]
  brief_notes: string | null
  success_metric: string | null
  success_target: number | null
  success_text: string | null
  why_data: string | null
  why_market: string | null
  sources: { title: string; url: string }[]
  confidence: string | null
  effort: string | null
  reject_reason: string | null
  sprint_test_id: string | null
}

const CONNECTED = ["linkedin", "google_ads", "meta"]
const OTHER: Record<string, string> = { reddit: "Reddit Ads", bing: "Microsoft Ads (Bing)", x: "X Ads", chatgpt: "ChatGPT Ads" }
const LINES = [
  "Letting your CTRs breathe…",
  "Notes of LinkedIn with a hint of Reddit…",
  "Checking what Google changed this week (again)…",
  "Swirling 12 weeks of cost per lead…",
  "Decanting your past sprints…",
  "Asking the sommelier about Performance Max…",
  "Pairing your budget with bolder tests…",
  "Crisp, dry, with a long finish of learnings…",
  "Reading the label on Meta's latest update…",
  "Chilling to the perfect hypothesis…",
]
const STATUS: Record<Recommendation["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-foreground/20 text-muted-foreground" },
  reviewed: { label: "Reviewed", cls: "border-lime/40 text-lime" },
  approved: { label: "Approved", cls: "border-rag-green/40 bg-rag-green/10 text-rag-green" },
  rejected: { label: "Rejected", cls: "border-rag-red/30 text-rag-red" },
}

/**
 * "Pour me a sprint": Claude suggests this sprint's tests from our data, past tests and paid media
 * news. GTM leads and admins generate, review and approve; everyone on the client can read.
 */
export function AiPanel(props: { sprintId: string; canGenerate: boolean; aiReady: boolean; closed: boolean; run: AiRun | null; recs: Recommendation[]; owners: Owner[]; defaultDeadline: string; currency: string }) {
  const router = useRouter()
  const [runId, setRunId] = useState<string | null>(props.run?.status === "generating" ? props.run.id : null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const pour = async () => {
    setError(null)
    setStarting(true)
    const res = await fetch("/api/sprint-ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sprintId: props.sprintId }) })
    const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string }
    setStarting(false)
    if (!res.ok || !body.runId) return setError(body.error ?? "Couldn't start.")
    setRunId(body.runId)
  }

  const open = props.recs.filter((r) => r.status === "draft" || r.status === "reviewed")
  const decided = props.recs.filter((r) => r.status === "approved" || r.status === "rejected")
  const [showDecided, setShowDecided] = useState(false)

  return (
    <section className="surface space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="eyebrow">Claude · sprint sommelier</p>
          <h2 className="text-2xl">Pour me a sprint</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Claude reads 12 weeks of Windsor data, every past test and the latest B2B paid media news (Google, Bing, LinkedIn, Meta, Reddit, ChatGPT Ads, X), then suggests tests. You review, then approve them into the plan.
          </p>
        </div>
        {props.canGenerate && !props.closed && (
          <div className="flex flex-col items-end gap-1">
            <Sparkle>
              <Button onClick={pour} disabled={starting || Boolean(runId) || !props.aiReady} title={props.aiReady ? undefined : "Add ANTHROPIC_API_KEY to .env.local"}>
                🥂 {starting ? "Uncorking…" : props.recs.length ? "Pour another" : "Pour me a sprint"}
              </Button>
            </Sparkle>
            {!props.aiReady && <p className="text-[11px] text-muted-foreground">Add ANTHROPIC_API_KEY to .env.local to switch this on.</p>}
          </div>
        )}
      </div>
      {error && <p className="text-sm text-rag-red">{error}</p>}
      {props.run?.status === "failed" && !runId && <p className="text-sm text-rag-red">The last pour spilled: {props.run.error ?? "something went wrong"}. Try again.</p>}

      {props.run?.market_summary && <MarketNotes run={props.run} />}

      {open.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2">
          {open.map((r) => (
            <RecCard key={r.id} rec={r} canEdit={props.canGenerate && !props.closed} owners={props.owners} defaultDeadline={props.defaultDeadline} currency={props.currency} />
          ))}
        </ul>
      )}
      {props.recs.length === 0 && !runId && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No suggestions yet for this sprint.</p>}
      {decided.length > 0 && (
        <div className="space-y-3">
          <button type="button" onClick={() => setShowDecided((s) => !s)} className="text-xs text-muted-foreground hover:text-foreground">
            {showDecided ? "Hide" : "Show"} {decided.length} decided suggestion{decided.length === 1 ? "" : "s"}
          </button>
          {showDecided && (
            <ul className="grid gap-3 lg:grid-cols-2">
              {decided.map((r) => (
                <RecCard key={r.id} rec={r} canEdit={false} owners={props.owners} defaultDeadline={props.defaultDeadline} currency={props.currency} />
              ))}
            </ul>
          )}
        </div>
      )}

      {runId && (
        <PourOverlay
          runId={runId}
          onDone={(ok, message) => {
            setRunId(null)
            if (!ok) setError(message ?? "The pour spilled. Try again.")
            router.refresh()
          }}
        />
      )}
    </section>
  )
}

/** The glass fills as Claude works; progress comes from the run row. */
function PourOverlay({ runId, onDone }: { runId: string; onDone: (ok: boolean, message?: string) => void }) {
  const [state, setState] = useState({ progress: 0.03, note: "Uncorking…", served: false })
  const [line, setLine] = useState(0)
  const [hidden, setHidden] = useState(false)
  const done = useRef(false)
  const finish = useCallback((ok: boolean, message?: string) => {
    if (done.current) return
    done.current = true
    onDone(ok, message)
  }, [onDone])

  useEffect(() => {
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 3800)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    let stop = false
    const tick = async () => {
      const res = await fetch(`/api/sprint-ai?run=${runId}`, { cache: "no-store" }).catch(() => null)
      const d = (await res?.json().catch(() => null)) as { status: string; progress: number; stage_note: string | null; error: string | null } | null
      if (stop || !d) return
      if (d.status === "ready") {
        setState({ progress: 1, note: "Your sprint is served.", served: true })
        setTimeout(() => finish(true), 1600)
        return
      }
      if (d.status === "failed") return finish(false, d.error ?? undefined)
      setState((s) => ({ ...s, progress: Math.max(s.progress, d.progress), note: d.stage_note ?? s.note }))
      setTimeout(tick, 1500)
    }
    void tick()
    return () => {
      stop = true
    }
  }, [runId, finish])

  if (hidden) {
    return (
      <button type="button" onClick={() => setHidden(false)} className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-lg">
        <WinePour progress={state.progress} className="h-6 w-5" /> Pouring… {Math.round(state.progress * 100)}%
      </button>
    )
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Creating your sprint">
      <div className="pour-in flex max-w-md flex-col items-center gap-5 text-center">
        <WinePour progress={state.progress} pouring={!state.served} className="h-72 w-60 text-foreground" />
        <div className="space-y-2">
          <p className="font-heading text-3xl leading-tight">{state.served ? "Your sprint is served." : "Go pour yourself a Sauvignon Blanc while I create your sprint."}</p>
          {!state.served && (
            <p key={line} className="pour-in text-sm text-lime" aria-live="polite">
              {LINES[line]}
            </p>
          )}
          <p className="line-clamp-2 min-h-[2lh] text-xs text-muted-foreground">{state.note}</p>
        </div>
        <div className="h-1 w-56 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-lime transition-[width] duration-700" style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
        {!state.served && (
          <button type="button" onClick={() => setHidden(true)} className="text-xs text-muted-foreground underline hover:text-foreground">
            Keep working. It&apos;ll keep pouring in the background.
          </button>
        )}
      </div>
    </div>
  )
}

function MarketNotes({ run }: { run: AiRun }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border bg-background/40">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start justify-between gap-3 p-4 text-left">
        <span className="space-y-1">
          <span className="block text-sm font-semibold">Tasting notes: what&apos;s moving in paid media</span>
          <span className={cn("block text-sm text-muted-foreground", !open && "line-clamp-2")}>{run.market_summary}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{open ? "Less" : `${run.news.length} updates`}</span>
      </button>
      {open && run.news.length > 0 && (
        <ul className="divide-y border-t">
          {run.news.map((n) => (
            <li key={n.url + n.headline} className="px-4 py-3 text-sm">
              <p>
                <span className="mr-2 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{n.platform}</span>
                <a href={n.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                  {n.headline}
                </a>
                {n.date && <span className="ml-2 text-xs text-muted-foreground">{n.date}</span>}
              </p>
              <p className="mt-1 text-muted-foreground">{n.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecCard({ rec: r, canEdit, owners, defaultDeadline, currency }: { rec: Recommendation; canEdit: boolean; owners: Owner[]; defaultDeadline: string; currency: string }) {
  const [mode, setMode] = useState<"view" | "edit" | "approve" | "reject">("view")
  const [f, setF] = useState({ title: r.title, hypothesis: r.hypothesis ?? "", brief_notes: r.brief_notes ?? "", success_metric: r.success_metric ?? "cost_per_result", success_target: r.success_target === null ? "" : String(r.success_target), success_text: r.success_text ?? "" })
  const [owner, setOwner] = useState(owners.find((o) => o.onTeam && o.id)?.id ?? "")
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const connected = CONNECTED.includes(r.platform)
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const res = await fn()
      if (res.ok) {
        setMode("view")
        setError(null)
      } else setError(res.message ?? "Couldn't save.")
    })
  const s = STATUS[r.status]

  return (
    <li id={`rec-${r.id}`} className={cn("space-y-3 rounded-lg border bg-card p-4", r.status === "rejected" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {connected || r.platform === "several" ? (
          <PlatformLabel platform={connected ? (r.platform as Platform) : null} className="text-muted-foreground" />
        ) : (
          <span className="text-muted-foreground">
            {OTHER[r.platform] ?? r.platform} <span className="ml-1 rounded border px-1 py-px text-[10px]">not connected</span>
          </span>
        )}
        <span className={cn("rounded-full border px-2 py-0.5", s.cls)}>{s.label}</span>
        {r.confidence && <span className="text-muted-foreground">· {r.confidence} confidence</span>}
        {r.effort && <span className="text-muted-foreground">· {r.effort} effort</span>}
      </div>

      {mode === "edit" ? (
        <div className="space-y-3">
          <Field label="What we're testing">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Hypothesis">
            <Textarea rows={2} value={f.hypothesis} onChange={(e) => setF({ ...f, hypothesis: e.target.value })} />
          </Field>
          <Field label="What to brief in">
            <Textarea rows={3} value={f.brief_notes} onChange={(e) => setF({ ...f, brief_notes: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[12rem_8rem_1fr]">
            <Field label="Success metric">
              <select className={fieldClass} value={f.success_metric} onChange={(e) => setF({ ...f, success_metric: e.target.value })}>
                {Object.entries(METRICS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Target">
              <Input type="number" min="0" step="any" value={f.success_target} onChange={(e) => setF({ ...f, success_target: e.target.value })} />
            </Field>
            <Field label="Or in words">
              <Input value={f.success_text} onChange={(e) => setF({ ...f, success_text: e.target.value })} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => reviewRecommendation(r.id, { ...f, success_metric: f.success_target ? f.success_metric : null }))}>
              {pending ? "Saving…" : "Save as reviewed"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-base font-semibold leading-snug">{r.title}</h3>
          {r.hypothesis && <p className="text-sm text-muted-foreground">{r.hypothesis}</p>}
          <dl className="space-y-2 text-sm">
            <Row label="Success">{successLine(r.success_metric, r.success_target, r.success_text, (v) => money(v, currency))}</Row>
            {r.why_data && <Row label="Why (your data)">{r.why_data}</Row>}
            {r.why_market && <Row label="Why (the market)">{r.why_market}</Row>}
            {r.brief_notes && <Row label="Brief">{r.brief_notes}</Row>}
          </dl>
          {r.assets.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.assets.map((a) => (
                <span key={a} className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {ASSETS[a] ?? a}
                </span>
              ))}
            </div>
          )}
          {r.sources.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {r.sources.map((src) => (
                <a key={src.url} href={src.url} target="_blank" rel="noreferrer" className="text-muted-foreground underline hover:text-foreground">
                  {src.title || new URL(src.url).hostname}
                </a>
              ))}
            </p>
          )}
          {r.status === "rejected" && r.reject_reason && <p className="text-xs text-rag-red">Rejected: {r.reject_reason}</p>}
          {r.status === "approved" && r.sprint_test_id && (
            <a href={`#test-${r.sprint_test_id}`} className="text-xs text-rag-green underline">
              Planned as a test ↓
            </a>
          )}
        </div>
      )}

      {mode === "approve" && (
        <div className="grid gap-3 rounded-md border bg-background/60 p-3 sm:grid-cols-2">
          <Field label="Owner">
            <select className={fieldClass} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">No owner yet</option>
              {owners.filter((o) => o.id).map((o) => (
                <option key={o.id} value={o.id!}>
                  {o.name}
                  {o.onTeam ? "" : " (not on this client)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Deadline">
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Sparkle>
              <Button size="sm" disabled={pending} onClick={() => run(() => approveRecommendation(r.id, { owner_notion_user_id: owner || null, deadline: deadline || null }))}>
                {pending ? "Planning…" : "Approve and plan the test"}
              </Button>
            </Sparkle>
            <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {mode === "reject" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background/60 p-3">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not? Claude reads this next time." className="h-8 min-w-0 flex-1" />
          <Button size="sm" variant="outline" disabled={pending || !reason.trim()} onClick={() => run(() => rejectRecommendation(r.id, reason))}>
            Reject
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
            Cancel
          </Button>
        </div>
      )}

      {canEdit && mode === "view" && (r.status === "draft" || r.status === "reviewed") && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {r.status === "draft" ? (
            <Button size="sm" onClick={() => setMode("edit")}>
              Review
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => setMode("approve")}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
                Edit
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-rag-red">{error}</p>}
    </li>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-subtle-foreground">{label}</dt>
      <dd className="whitespace-pre-line">{children}</dd>
    </div>
  )
}
