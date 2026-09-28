"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { fieldClass } from "@/components/admin-form"
import { PlatformIcon, PlatformLabel } from "@/components/brand"
import { Sparkle } from "@/components/fx/sparkle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { money, shortDate, withSymbols } from "@/lib/format"
import type { Platform } from "@/lib/metrics/types"
import { ASSETS, METRICS, successLine } from "@/lib/sprints/tests"
import { cn } from "@/lib/utils"
import { approveRecommendation, rejectRecommendation, reviewRecommendation } from "./ai-actions"
import type { Owner } from "./plan-test-form"
import { WinePour } from "@/components/fx/wine-pour"
import { PourOverlay } from "./pour-overlay"

export type AiRun = { id: string; status: "generating" | "ready" | "failed"; created_at: string; market_summary: string | null; news: NewsItem[]; error: string | null }
type NewsItem = { platform: string; headline: string; detail: string; date?: string; url: string }
type Level = "low" | "medium" | "high"
export type Recommendation = {
  id: string
  run_id: string
  status: "draft" | "reviewed" | "approved" | "rejected"
  platform: string
  title: string
  summary: string | null
  impact: Level | null
  expected_impact: string | null
  evidence: { label: string; value: string }[]
  hypothesis: string | null
  assets: string[]
  brief_notes: string | null
  success_metric: string | null
  success_target: number | null
  success_text: string | null
  why_data: string | null
  why_market: string | null
  sources: { title: string; url: string }[]
  confidence: Level | null
  effort: Level | null
  reject_reason: string | null
  sprint_test_id: string | null
}

const CONNECTED = ["linkedin", "google_ads", "meta"]
const OTHER: Record<string, string> = { reddit: "Reddit Ads", bing: "Microsoft Ads", x: "X Ads", chatgpt: "ChatGPT Ads" }
const W: Record<Level, number> = { low: 1, medium: 2, high: 3 }
type Tab = "open" | "approved" | "rejected"

/** Priority: impact counts most, then confidence, and effort pulls it down (Google Ads-style ranking). */
const score = (r: Recommendation) => W[r.impact ?? r.confidence ?? "medium"] * 3 + W[r.confidence ?? "medium"] * 2 - W[r.effort ?? "medium"]
const firstSentence = (t: string | null) => (t ? (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim().slice(0, 160) : null)
const summaryOf = (r: Recommendation) => withSymbols(r.summary ?? firstSentence(r.why_data) ?? "")

function tags(r: Recommendation, rank: number) {
  const out: { label: string; cls: string }[] = []
  if (rank === 0) out.push({ label: "Top pick", cls: "border-lime/40 bg-lime/10 text-lime" })
  if (r.effort === "low" && (r.impact ?? r.confidence) !== "low") out.push({ label: "Quick win", cls: "border-foreground/20 text-foreground" })
  if (r.confidence === "low" || !(CONNECTED.includes(r.platform) || r.platform === "several")) out.push({ label: "Bold bet", cls: "border-violet-400/30 text-violet-300" })
  return out
}

/**
 * "Pour me a sprint": Claude's suggested tests as a ranked review queue (list + detail, like
 * Linear's triage and Google Ads recommendations). GTM leads and admins review and approve.
 */
export function AiPanel(props: { sprintId: string; canGenerate: boolean; aiReady: boolean; closed: boolean; run: AiRun | null; recs: Recommendation[]; owners: Owner[]; defaultDeadline: string; currency: string }) {
  const router = useRouter()
  const [runId, setRunId] = useState<string | null>(props.run?.status === "generating" ? props.run.id : null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [tab, setTab] = useState<Tab>("open")
  const [picked, setPicked] = useState<string | null>(null)

  const pour = async () => {
    setError(null)
    setStarting(true)
    const res = await fetch("/api/sprint-ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sprintId: props.sprintId }) })
    const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string }
    setStarting(false)
    if (!res.ok || !body.runId) return setError(body.error ?? "Couldn't start.")
    setRunId(body.runId)
  }

  const latestRun = props.run?.id
  const lists = useMemo(() => {
    const ranked = [...props.recs].sort((a, b) => Number(b.run_id === latestRun) - Number(a.run_id === latestRun) || score(b) - score(a))
    return {
      open: ranked.filter((r) => r.status === "draft" || r.status === "reviewed"),
      approved: ranked.filter((r) => r.status === "approved"),
      rejected: ranked.filter((r) => r.status === "rejected"),
    }
  }, [props.recs, latestRun])
  const list = lists[tab]
  // Keep a selection that's still in this tab; otherwise the top of the list.
  const selected = list.find((r) => r.id === picked) ?? list[0] ?? null
  const reviewed = lists.open.filter((r) => r.status === "reviewed").length
  const overlay = runId && (
    <PourOverlay
      runId={runId}
      onDone={(ok, message) => {
        setRunId(null)
        setTab("open")
        setPicked(null)
        if (!ok) setError(message ?? "The pour spilled. Try again.")
        router.refresh()
      }}
    />
  )
  const failed = error ?? (props.run?.status === "failed" && !runId ? `The last pour spilled: ${props.run?.error ?? "something went wrong"}. Try again.` : null)

  if (props.recs.length === 0) {
    return (
      <>
        <PourHero canGenerate={props.canGenerate && !props.closed} aiReady={props.aiReady} busy={starting || Boolean(runId)} onPour={pour} error={failed} />
        {overlay}
      </>
    )
  }

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-2xl">Your suggested sprints</h2>
          <p className="text-sm text-muted-foreground">
            {props.run?.status === "ready" ? `Poured ${shortDate(props.run.created_at)} from 12 weeks of data, past tests and this week's paid media news.` : "Suggested tests from 12 weeks of data, past tests and the latest paid media news."}
          </p>
        </div>
        {props.canGenerate && !props.closed && (
          <div className="flex flex-col items-end gap-1">
            <PourButton onClick={pour} disabled={starting || Boolean(runId) || !props.aiReady} size="sm">
              {starting ? "Uncorking…" : "Pour another"}
            </PourButton>
            {!props.aiReady && <p className="text-[11px] text-muted-foreground">Add ANTHROPIC_API_KEY to .env.local to switch this on.</p>}
          </div>
        )}
      </div>

      {failed && <p className="border-b px-5 py-2.5 text-sm text-rag-red">{failed}</p>}
      {props.run?.market_summary && <MarketNotes run={props.run} />}

      <>
          {/* Queue tabs and progress */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-2.5">
            <div role="tablist" className="flex gap-1 text-sm">
              {(
                [
                  ["open", "To review", lists.open.length],
                  ["approved", "Approved", lists.approved.length],
                  ["rejected", "Rejected", lists.rejected.length],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn("rounded-md px-3 py-1.5 transition-colors", tab === k ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {label} <span className="ml-1 text-xs tabular-nums text-muted-foreground">{n}</span>
                </button>
              ))}
            </div>
            {lists.open.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="text-foreground">{reviewed}</span> of {lists.open.length} reviewed · review, then approve into the plan
              </p>
            )}
          </div>

          {list.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">{tab === "open" ? "All caught up. Every suggestion has been decided." : `Nothing ${tab} yet.`}</p>
          ) : (
            <div className="grid lg:grid-cols-[minmax(0,21rem)_1fr]">
              <ol className="divide-y border-b lg:border-r lg:border-b-0">
                {list.map((r, i) => (
                  <QueueRow key={r.id} rec={r} rank={i} tab={tab} active={selected?.id === r.id} earlier={r.run_id !== latestRun} onClick={() => setPicked(r.id)} />
                ))}
              </ol>
              {selected && (
                <Detail
                  key={selected.id}
                  rec={selected}
                  rank={list.indexOf(selected)}
                  tab={tab}
                  canEdit={props.canGenerate && !props.closed}
                  owners={props.owners}
                  defaultDeadline={props.defaultDeadline}
                  currency={props.currency}
                />
              )}
            </div>
          )}
      </>
      {overlay}
    </section>
  )
}

/** Before the first pour: a small banner that invites the click. Hovering it pours the glass. */
function PourHero({ canGenerate, aiReady, busy, onPour, error }: { canGenerate: boolean; aiReady: boolean; busy: boolean; onPour: () => void; error: string | null }) {
  return (
    <section className="group/pour relative isolate overflow-hidden rounded-xl p-px">
      {/* Travelling glow border */}
      <div aria-hidden className="pour-border absolute top-1/2 left-1/2 -z-10 size-[250%] -translate-x-1/2 -translate-y-1/2 opacity-60 transition-opacity duration-500 group-hover/pour:opacity-100" />
      <div className="relative overflow-hidden rounded-[11px] bg-card">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-lime/10 blur-3xl transition-colors duration-700 group-hover/pour:bg-lime/20" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-violet-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:px-7">
          <WinePour progress={0.35} pouring={false} hoverPour className="hidden h-32 w-24 shrink-0 text-foreground sm:block" />
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-3xl leading-tight">
              Pour me a <span className="text-lime">sprint</span>
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">Up to five data-backed tests for this sprint, ranked by impact. You review every one before it goes on the board.</p>
            <ul className="flex flex-wrap gap-1.5 pt-1 text-[11px] text-muted-foreground">
              {["12 weeks of Windsor data", "Every past test", "This week\u2019s platform news"].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-background/40 px-2.5 py-1">
                  <span className="size-1 rounded-full bg-lime" /> {t}
                </li>
              ))}
            </ul>
          </div>
          {canGenerate && (
            <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
              <PourButton onClick={onPour} disabled={busy || !aiReady}>
                {busy ? "Uncorking…" : "Pour me a sprint"}
              </PourButton>
              <p className="text-[11px] text-muted-foreground">{aiReady ? "About 2 minutes. Go pour yourself one." : "Add ANTHROPIC_API_KEY to .env.local to switch this on."}</p>
            </div>
          )}
        </div>
        {error && <p className="relative border-t px-7 py-2.5 text-sm text-rag-red">{error}</p>}
      </div>
    </section>
  )
}

/** Lime button that fills with wine from the bottom on hover, with sparkles around it. */
function PourButton({ children, onClick, disabled, size = "lg" }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; size?: "sm" | "lg" }) {
  return (
    <Sparkle>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "group/btn relative isolate inline-flex items-center gap-2 overflow-hidden rounded-full bg-lime font-medium text-[#0a0a0a] transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_32px_-6px_rgba(228,255,26,0.7)] focus-visible:ring-2 focus-visible:ring-lime/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
          size === "lg" ? "h-11 px-6 text-sm" : "h-9 px-4 text-sm",
        )}
      >
        {/* The wine rising */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-0 bg-[#f6f0b4] transition-[height] duration-700 ease-out group-hover/btn:h-[140%]">
          <svg viewBox="0 0 80 8" preserveAspectRatio="none" className="wine-wave absolute -top-1.5 left-0 h-2 w-[200%] fill-[#f6f0b4]">
            <path d="M0 8 V4 Q5 0 10 4 T20 4 T30 4 T40 4 T50 4 T60 4 T70 4 T80 4 V8 Z" />
          </svg>
        </span>
        <GlassIcon className="size-4 transition-transform duration-500 group-hover/btn:-rotate-[18deg]" />
        {children}
      </button>
    </Sparkle>
  )
}

function GlassIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className={className} aria-hidden>
      <path d="M4.5 1.5h7c0 3.6-1.3 6-3.5 6s-3.5-2.4-3.5-6Z" />
      <path d="M5 4.2h6" strokeOpacity="0.5" />
      <path d="M8 7.5v5.5M5.5 14.5h5" />
    </svg>
  )
}

function QueueRow({ rec: r, rank, tab, active, earlier, onClick }: { rec: Recommendation; rank: number; tab: Tab; active: boolean; earlier: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active}
        className={cn("relative flex w-full gap-3 px-4 py-3.5 text-left transition-colors", active ? "bg-accent/70" : "hover:bg-accent/30")}
      >
        {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-lime" aria-hidden />}
        <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums", tab === "open" && rank === 0 ? "border-lime/50 text-lime" : "text-muted-foreground")}>
          {rank + 1}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-start gap-2">
            <PlatformIcon platform={CONNECTED.includes(r.platform) ? (r.platform as Platform) : null} className="mt-0.5 size-3.5 shrink-0" />
            <span className="line-clamp-2 text-sm font-medium leading-snug">{withSymbols(r.title)}</span>
          </span>
          <span className="line-clamp-1 text-xs text-muted-foreground">{summaryOf(r)}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
            {(r.impact ?? r.confidence) && <Meter label="impact" level={(r.impact ?? r.confidence)!} />}
            {r.effort && <span>{cap(r.effort)} effort</span>}
            {r.status === "reviewed" && (
              <span className="inline-flex items-center gap-1 text-lime">
                <span className="size-1.5 rounded-full bg-lime" /> Reviewed
              </span>
            )}
            {earlier && <span>Earlier pour</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

function Detail({ rec: r, rank, tab, canEdit, owners, defaultDeadline, currency }: { rec: Recommendation; rank: number; tab: Tab; canEdit: boolean; owners: Owner[]; defaultDeadline: string; currency: string }) {
  const [mode, setMode] = useState<"view" | "edit" | "approve" | "reject">("view")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const res = await fn()
      if (res.ok) {
        setMode("view")
        setError(null)
      } else setError(res.message ?? "Couldn't save.")
    })
  const connected = CONNECTED.includes(r.platform)
  const open = r.status === "draft" || r.status === "reviewed"

  return (
    <article className="flex min-w-0 flex-col">
      <div className="min-w-0 flex-1 space-y-5 p-5">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {connected || r.platform === "several" ? (
              <PlatformLabel platform={connected ? (r.platform as Platform) : null} className="text-muted-foreground" />
            ) : (
              <span className="text-muted-foreground">
                {OTHER[r.platform] ?? r.platform} · not connected
              </span>
            )}
            {tab === "open" && tags(r, rank).map((t) => <span key={t.label} className={cn("rounded-full border px-2 py-0.5", t.cls)}>{t.label}</span>)}
            {r.status === "reviewed" && <span className="rounded-full border border-lime/40 px-2 py-0.5 text-lime">Reviewed</span>}
          </div>
          <h3 className="text-xl font-semibold leading-snug">{withSymbols(r.title)}</h3>
          <p className="text-sm text-muted-foreground">{summaryOf(r)}</p>
        </div>

        {mode === "edit" ? (
          <EditForm rec={r} pending={pending} onCancel={() => setMode("view")} onSave={(f) => run(() => reviewRecommendation(r.id, f))} />
        ) : (
          <>
            {/* The case, at a glance */}
            {r.evidence.length > 0 && (
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
                {r.evidence.map((e) => (
                  <div key={e.label} className="bg-card px-3.5 py-3">
                    <dd className="font-heading text-2xl leading-none tabular-nums">{withSymbols(e.value)}</dd>
                    <dt className="mt-1.5 text-[11px] text-muted-foreground">{e.label}</dt>
                  </div>
                ))}
              </dl>
            )}

            <div className="grid gap-4 rounded-lg border-l-2 border-lime/60 bg-background/50 py-3 pr-4 pl-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">Expected impact</p>
                <p className="mt-1 text-sm">{r.expected_impact ? withSymbols(r.expected_impact) : `${cap(r.impact ?? r.confidence ?? "medium")} impact`}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">Success looks like</p>
                <p className="mt-1 text-sm">{withSymbols(successLine(r.success_metric, r.success_target, r.success_text, (v) => money(v, currency)))}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
              {(r.impact ?? r.confidence) && <Meter label="Impact" level={(r.impact ?? r.confidence)!} labelFirst />}
              {r.confidence && <Meter label="Confidence" level={r.confidence} labelFirst />}
              {r.effort && <Meter label="Effort" level={r.effort} labelFirst />}
            </div>

            {/* Detail on demand */}
            <div className="divide-y rounded-lg border">
              {r.why_data && <Section title="Why: your data" defaultOpen>{withSymbols(r.why_data)}</Section>}
              {r.why_market && <Section title="Why: the market">{withSymbols(r.why_market)}</Section>}
              {(r.hypothesis || r.brief_notes || r.assets.length > 0) && (
                <Section title="Hypothesis and what to brief">
                  {r.hypothesis && <p>{withSymbols(r.hypothesis)}</p>}
                  {r.brief_notes && <p className="mt-2 text-muted-foreground">{withSymbols(r.brief_notes)}</p>}
                  {r.assets.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1">
                      {r.assets.map((a) => (
                        <span key={a} className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {ASSETS[a] ?? a}
                        </span>
                      ))}
                    </p>
                  )}
                </Section>
              )}
            </div>

            {r.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-subtle-foreground">Sources</span>
                {r.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.title} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                    {/* eslint-disable-next-line @next/next/no-img-element -- tiny favicon from Google's public service */}
                    <img src={`https://www.google.com/s2/favicons?domain=${host(s.url)}&sz=32`} alt="" className="size-3 rounded-sm" />
                    {host(s.url)}
                  </a>
                ))}
              </div>
            )}

            {r.status === "rejected" && r.reject_reason && <p className="rounded-md border border-rag-red/30 px-3 py-2 text-sm text-rag-red">Rejected: {r.reject_reason}</p>}
            {r.status === "approved" && r.sprint_test_id && (
              <a href={`#test-${r.sprint_test_id}`} className="inline-block text-sm text-rag-green underline">
                Planned as a test. See it on the board ↓
              </a>
            )}
          </>
        )}

        {mode === "approve" && <ApproveForm owners={owners} defaultDeadline={defaultDeadline} pending={pending} onCancel={() => setMode("view")} onApprove={(v) => run(() => approveRecommendation(r.id, v))} />}
        {mode === "reject" && <RejectForm pending={pending} onCancel={() => setMode("view")} onReject={(reason) => run(() => rejectRecommendation(r.id, reason))} />}
        {error && <p className="text-xs text-rag-red">{error}</p>}
      </div>

      {/* One clear next step */}
      {canEdit && open && mode === "view" && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-card/95 px-5 py-3 backdrop-blur">
          {r.status === "draft" ? (
            <>
              <Button size="sm" onClick={() => setMode("edit")}>
                Review
              </Button>
              <span className="text-xs text-muted-foreground">Check and tweak it, then approve.</span>
            </>
          ) : (
            <>
              <Sparkle>
                <Button size="sm" onClick={() => setMode("approve")}>
                  Approve
                </Button>
              </Sparkle>
              <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
                Edit
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      )}
    </article>
  )
}

function EditForm({ rec: r, pending, onSave, onCancel }: { rec: Recommendation; pending: boolean; onSave: (f: { title: string; hypothesis: string; brief_notes: string; success_metric: string | null; success_target: string; success_text: string }) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    title: withSymbols(r.title),
    hypothesis: withSymbols(r.hypothesis ?? ""),
    brief_notes: withSymbols(r.brief_notes ?? ""),
    success_metric: r.success_metric ?? "cost_per_result",
    success_target: r.success_target === null ? "" : String(r.success_target),
    success_text: withSymbols(r.success_text ?? ""),
  })
  return (
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
      <div className="grid gap-3 sm:grid-cols-[11rem_7rem_1fr]">
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
        <Button size="sm" disabled={pending} onClick={() => onSave({ ...f, success_metric: f.success_target ? f.success_metric : null })}>
          {pending ? "Saving…" : "Save as reviewed"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ApproveForm({ owners, defaultDeadline, pending, onApprove, onCancel }: { owners: Owner[]; defaultDeadline: string; pending: boolean; onApprove: (v: { owner_notion_user_id: string | null; deadline: string | null }) => void; onCancel: () => void }) {
  const [owner, setOwner] = useState(owners.find((o) => o.onTeam && o.id)?.id ?? "")
  const [deadline, setDeadline] = useState(defaultDeadline)
  return (
    <div className="grid gap-3 rounded-lg border bg-background/60 p-4 sm:grid-cols-2">
      <p className="text-sm font-medium sm:col-span-2">Add it to this sprint&apos;s plan</p>
      <Field label="Owner">
        <select className={fieldClass} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">No owner yet</option>
          {owners
            .filter((o) => o.id)
            .map((o) => (
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
          <Button size="sm" disabled={pending} onClick={() => onApprove({ owner_notion_user_id: owner || null, deadline: deadline || null })}>
            {pending ? "Planning…" : "Approve and plan the test"}
          </Button>
        </Sparkle>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function RejectForm({ pending, onReject, onCancel }: { pending: boolean; onReject: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("")
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/60 p-3">
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not? Claude reads this next time." className="h-8 min-w-0 flex-1" autoFocus />
      <Button size="sm" variant="outline" disabled={pending || !reason.trim()} onClick={() => onReject(reason)}>
        Reject
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

function MarketNotes({ run }: { run: AiRun }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-accent/30">
        <span className="shrink-0 text-xs font-semibold">Tasting notes</span>
        <span className={cn("min-w-0 flex-1 text-xs text-muted-foreground", !open && "truncate")}>{withSymbols(run.market_summary ?? "")}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{run.news.length} platform updates</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && run.news.length > 0 && (
        <ul className="grid gap-px border-t bg-border sm:grid-cols-2">
          {run.news.map((n) => (
            <li key={n.url + n.headline} className="bg-card px-5 py-3 text-sm">
              <p className="text-[11px] text-muted-foreground">
                {n.platform}
                {n.date ? ` · ${n.date}` : ""}
              </p>
              <a href={n.url} target="_blank" rel="noreferrer" className="mt-0.5 block font-medium leading-snug hover:underline">
                {withSymbols(n.headline)}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">{withSymbols(n.detail)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="whitespace-pre-line px-4 pb-3.5 text-sm leading-relaxed">{children}</div>
    </details>
  )
}

/** Three small bars, like a signal meter. */
function Meter({ label, level, labelFirst = false }: { label: string; level: Level; labelFirst?: boolean }) {
  const n = W[level]
  return (
    <span className="inline-flex items-center gap-1.5" title={`${cap(level)} ${label.toLowerCase()}`}>
      {labelFirst && <span>{label}</span>}
      <span className="inline-flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("w-[3px] rounded-sm", i <= n ? "bg-lime" : "bg-foreground/15")} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      {labelFirst && <span className="sr-only">{cap(level)}</span>}
      {!labelFirst && <span>{cap(level)} {label}</span>}
    </span>
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
