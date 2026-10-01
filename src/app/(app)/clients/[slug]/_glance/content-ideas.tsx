"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { ChevronDown, Lightbulb, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { PlatformIcon } from "@/components/brand"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { money, percent, whole } from "@/lib/format"
import type { Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"
import { markContentIdea, planContentIdea } from "./content-actions"

export type Working = { content_type: string; topic: string; format: string; platform: Platform; audience: string; campaigns: string[]; spend: number; results: number; ctr: number | null; verdict: "working" | "mixed" | "not_working" | "too_early"; why: string }
export type Idea = {
  id: string
  title: string
  kind: string
  content_type: string
  topic: string
  platform: Platform
  format: string
  audience: string
  audience_basis: "same" | "new"
  built_on: { ref: string; what: string }[]
  evidence: string
  why_it_fits: string
  hook: string
  success: string
  impact: number
  confidence: number
  effort: number
  call_commitment_id?: string | null
}
export type IdeaRun = { id: string; headline: string | null; working: Working[]; ideas: Idea[]; avoid: { what: string; why: string }[]; when: string }
export type IdeaState = { action: "planned" | "dismissed"; reason: string | null; testUrl: string | null }
type Owner = { notionUserId: string; name: string }

const KIND: Record<string, string> = { new_content: "New content piece", repurpose: "Repurpose what works", new_angle: "New angle", new_audience: "New audience", new_format: "New format" }
const VERDICT = {
  working: { label: "Working", dot: "bg-rag-green" },
  mixed: { label: "Mixed", dot: "bg-rag-amber" },
  not_working: { label: "Not working", dot: "bg-rag-red" },
  too_early: { label: "Too early to tell", dot: "bg-rag-na" },
} as const

/**
 * Content ideas on At a glance (Dean, 2026-09-29: "we are a content first agency"): what content is
 * working and for whom, then Claude's ideas for content, ads and angles to brief in or test, each
 * matched to the audience it's for. Plan one as a sprint test, or say it's not for us (Claude reads why).
 */
export function ContentIdeas({ slug, currency, run, running, states, owners, canRun, canEdit, deadline }: { slug: string; currency: string; run: IdeaRun | null; running: { id: string; progress: string | null } | null; states: Record<string, IdeaState>; owners: Owner[]; canRun: boolean; canEdit: boolean; deadline: string }) {
  const router = useRouter()
  const [runId, setRunId] = useState<string | null>(running?.id ?? null)
  const [progress, setProgress] = useState<string | null>(running?.progress ?? null)
  const [starting, setStarting] = useState(false)
  const [allWorking, setAllWorking] = useState(false)

  // While a run is going, poll it; refresh the page when it's done.
  useEffect(() => {
    if (!runId) return
    let stop = false
    const tick = async () => {
      const r = await fetch(`/api/content-ideas?run=${runId}`).then((x) => x.json()).catch(() => null)
      if (stop || !r) return
      if (r.status === "generating") {
        setProgress(r.progress)
        setTimeout(tick, 3000)
      } else {
        setRunId(null)
        if (r.status === "failed") toast.error(`Couldn't get ideas: ${r.error ?? "unknown error"}`)
        router.refresh()
      }
    }
    const t = setTimeout(tick, 2000)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [runId, router])

  const start = async () => {
    setStarting(true)
    const r = await fetch("/api/content-ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientSlug: slug }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't start." }))
    setStarting(false)
    if (r.error) return void toast.error(r.error)
    setProgress("Starting")
    setRunId(r.runId)
  }

  const open = (run?.ideas ?? []).filter((i) => states[i.id]?.action !== "dismissed")
  const dismissed = (run?.ideas ?? []).filter((i) => states[i.id]?.action === "dismissed")
  const working = allWorking ? (run?.working ?? []) : (run?.working ?? []).slice(0, 5)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{run ? `Read ${run.when}` : "Not run yet for this client."}</span>
        {canRun && !runId && (
          <Button size="sm" variant={run ? "outline" : "default"} onClick={start} disabled={starting} className="gap-1.5">
            {run ? <RefreshCw className="size-3.5" aria-hidden /> : <Lightbulb className="size-3.5" aria-hidden />}
            {starting ? "Starting…" : run ? "Refresh ideas" : "Get content ideas"}
          </Button>
        )}
      </div>

      {runId && (
        <div className="surface space-y-2 p-4" aria-live="polite">
          <p className="text-sm">{progress ?? "Working"}…</p>
          <span className="block h-1 overflow-hidden rounded-full bg-secondary">
            <span className="block h-full w-1/3 animate-[slide_1.6s_ease-in-out_infinite] rounded-full bg-lime motion-reduce:animate-none" />
          </span>
          <p className="text-xs text-muted-foreground">Claude reads every campaign, who it reached and the ad creatives. It takes a minute or two; you can leave this page.</p>
        </div>
      )}

      {!run && !runId && (
        <p className="surface px-5 py-6 text-sm text-muted-foreground">
          Claude looks at the content we&apos;ve run (the offer, the format and the creative itself), who it reached and how it did, then suggests content, ads and angles to brief in or test, each matched to the audience it&apos;s for.
        </p>
      )}

      {run && (
        <>
          {run.headline && <p className="border-l-2 border-lime pl-4 text-base leading-relaxed">{run.headline}</p>}

          {/* What's working */}
          {run.working.length > 0 && (
            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-base font-semibold">
                What content is working, and for whom
                <Hint>Grouped by content piece and the audience it went to, over the last 90 days. Small numbers are noisy, so a piece with one or two results is marked &ldquo;too early&rdquo;.</Hint>
              </h3>
              <ul className="surface divide-y">
                {working.map((w, n) => (
                  <li key={n} className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_14rem]">
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className={cn("size-2 shrink-0 rounded-full", VERDICT[w.verdict].dot)} title={VERDICT[w.verdict].label} aria-label={VERDICT[w.verdict].label} />
                        <PlatformIcon platform={w.platform} className="size-3.5" />
                        <span className="rounded-full border px-2 py-px text-[11px] text-muted-foreground">{w.content_type}</span>
                        <span className="font-medium">{w.topic}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {w.format} · to {w.audience}
                      </p>
                      <p className="text-xs text-foreground/80">{w.why}</p>
                    </div>
                    <p className="text-xs tabular-nums text-muted-foreground md:text-right">
                      <span className="text-sm text-foreground">{w.results > 0 ? `${money(w.spend / w.results, currency)} per result` : "No results"}</span>
                      <span className="block">
                        {whole(w.results)} results · {money(w.spend, currency)}
                        {w.ctr !== null ? ` · ${percent(w.ctr, 2)} CTR` : ""}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
              {run.working.length > 5 && (
                <button type="button" onClick={() => setAllWorking(!allWorking)} className="text-xs text-muted-foreground hover:text-foreground">
                  {allWorking ? "Show fewer" : `Show all ${run.working.length}`}
                </button>
              )}
            </div>
          )}

          {/* Ideas */}
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-base font-semibold">
              Ideas to brief in or test
              <Hint>Each idea says who it&apos;s for and why that topic suits them. &ldquo;Same audience&rdquo; builds on people who already responded; &ldquo;New audience&rdquo; takes a proven piece to new people inside the ICP.</Hint>
            </h3>
            {open.length === 0 ? (
              <p className="surface px-4 py-4 text-sm text-muted-foreground">Every idea from this run has been handled. Refresh for new ones.</p>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {open.map((i) => (
                  <IdeaCard key={i.id} slug={slug} runId={run.id} idea={i} state={states[i.id]} owners={owners} canEdit={canEdit} deadline={deadline} />
                ))}
              </ul>
            )}
            {dismissed.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">{dismissed.length} not for us</summary>
                <ul className="mt-2 space-y-1.5">
                  {dismissed.map((i) => (
                    <DismissedRow key={i.id} slug={slug} runId={run.id} idea={i} reason={states[i.id]?.reason ?? null} canEdit={canEdit} />
                  ))}
                </ul>
              </details>
            )}
          </div>

          {run.avoid.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-base font-semibold">Worth not repeating</h3>
              <ul className="surface divide-y text-sm">
                {run.avoid.map((a, n) => (
                  <li key={n} className="px-4 py-2.5">
                    <span className="font-medium">{a.what}</span>
                    <span className="text-muted-foreground"> · {a.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function IdeaCard({ slug, runId, idea: i, state, owners, canEdit, deadline }: { slug: string; runId: string; idea: Idea; state?: IdeaState; owners: Owner[]; canEdit: boolean; deadline: string }) {
  const [mode, setMode] = useState<"idle" | "plan" | "dismiss">("idle")
  const [more, setMore] = useState(false)
  const [title, setTitle] = useState(i.title)
  const [success, setSuccess] = useState(i.success)
  const [owner, setOwner] = useState(owners[0]?.notionUserId ?? "")
  const [due, setDue] = useState(deadline)
  const [reason, setReason] = useState("")
  const [pending, start] = useTransition()
  const router = useRouter()

  const plan = () =>
    start(async () => {
      const r = await planContentIdea(slug, runId, i.id, { title, success_text: success, owner_notion_user_id: owner || null, deadline: due || null })
      if (!r.ok) return void toast.error(r.message ?? "Couldn't plan it.")
      toast.success(r.message ?? "Planned.")
      setMode("idle")
      router.refresh()
    })
  const dismiss = () =>
    start(async () => {
      const r = await markContentIdea(slug, runId, i.id, "dismissed", reason)
      if (!r.ok) return void toast.error(r.message ?? "Couldn't save that.")
      router.refresh()
    })

  return (
    <li className="surface flex flex-col">
      <div className="flex-1 space-y-3 p-4">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-full bg-lavender/15 px-2 py-0.5 font-medium text-lavender">{i.content_type}</span>
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground">{KIND[i.kind] ?? i.kind}</span>
          <span className={cn("rounded-full border px-2 py-0.5", i.audience_basis === "new" ? "border-violet/40 text-violet" : "text-muted-foreground")}>{i.audience_basis === "new" ? "New audience" : "Same audience"}</span>
          {i.call_commitment_id && (
            <span className="rounded-full border border-[#f0a6ca]/40 bg-[#f0a6ca]/10 px-2 py-0.5 font-medium text-[#f0a6ca]" title="Follows up something the client said on a call">
              From a call
            </span>
          )}
        </p>
        <h4 className="text-base leading-snug font-semibold">{i.title}</h4>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <PlatformIcon platform={i.platform} className="mt-px size-3.5 shrink-0" />
          <span>
            {i.format} · for {i.audience}
          </span>
        </p>
        <p className="rounded-md bg-secondary/60 px-3 py-2 text-sm italic">&ldquo;{i.hook}&rdquo;</p>
        <p className="text-sm text-foreground/85">{i.why_it_fits}</p>
        <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} aria-hidden />
          Evidence and what it builds on
        </button>
        {more && (
          <div className="space-y-2 text-xs">
            <p>{i.evidence}</p>
            {i.built_on.length > 0 && (
              <ul className="space-y-1 text-muted-foreground">
                {i.built_on.map((b, n) => (
                  <li key={n}>
                    <span className="text-foreground">{b.ref}</span>: {b.what}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground">
              Success: <span className="text-foreground">{i.success}</span>
            </p>
            <p className="flex gap-4 text-muted-foreground">
              <Meter label="Impact" v={i.impact} />
              <Meter label="Confidence" v={i.confidence} />
              <Meter label="Effort" v={i.effort} />
            </p>
          </div>
        )}
      </div>

      <div className="border-t px-4 py-3">
        {state?.action === "planned" ? (
          <p className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-rag-green">
              <span className="size-1.5 rounded-full bg-rag-green" aria-hidden /> Planned as a sprint test
            </span>
            {state.testUrl && (
              <Link href={state.testUrl} className="text-muted-foreground hover:text-foreground">
                Open the test →
              </Link>
            )}
          </p>
        ) : !canEdit ? (
          <p className="text-xs text-muted-foreground">The paid media team plans these.</p>
        ) : mode === "plan" ? (
          <div className="space-y-2">
            <label className="block space-y-1 text-xs text-muted-foreground">
              Test title
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" maxLength={200} />
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
              What success looks like
              <Input value={success} onChange={(e) => setSuccess(e.target.value)} className="h-8" maxLength={500} />
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Owner
                <select value={owner} onChange={(e) => setOwner(e.target.value)} className="block h-8 rounded-md border bg-background px-2 text-sm text-foreground">
                  <option value="">No owner yet</option>
                  {owners.map((o) => (
                    <option key={o.notionUserId} value={o.notionUserId}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Deadline
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-40" />
              </label>
              <Button size="sm" onClick={plan} disabled={pending}>
                {pending ? "Planning…" : "Plan it"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : mode === "dismiss" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not? Claude reads this next time" className="h-8 min-w-48 flex-1" maxLength={500} onKeyDown={(e) => e.key === "Enter" && dismiss()} />
            <Button size="sm" variant="outline" onClick={dismiss} disabled={pending || !reason.trim()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setMode("plan")}>
              Plan as sprint test
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("dismiss")}>
              Not for us
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

function DismissedRow({ slug, runId, idea, reason, canEdit }: { slug: string; runId: string; idea: Idea; reason: string | null; canEdit: boolean }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="text-foreground/80">{idea.title}</span>
      {reason && <span>· {reason}</span>}
      {canEdit && (
        <button
          type="button"
          disabled={pending}
          className="underline-offset-2 hover:text-foreground hover:underline"
          onClick={() =>
            start(async () => {
              const r = await markContentIdea(slug, runId, idea.id, "reopened", "")
              if (!r.ok) return void toast.error(r.message ?? "Couldn't bring it back.")
              router.refresh()
            })
          }
        >
          Bring back
        </button>
      )}
    </li>
  )
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <span className="flex items-center gap-1.5" title={`${label} ${v} of 5`}>
      {label}
      <span className="flex gap-0.5" aria-label={`${v} of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cn("h-1.5 w-2.5 rounded-full", n <= v ? "bg-foreground/70" : "bg-secondary")} />
        ))}
      </span>
    </span>
  )
}
