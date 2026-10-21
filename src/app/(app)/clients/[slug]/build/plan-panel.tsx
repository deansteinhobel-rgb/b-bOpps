"use client"

import { createClient as createSupabase } from "@supabase/supabase-js"
import { AlertTriangle, ArrowLeft, Check as CheckIcon, ExternalLink, Pencil, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { Spinner } from "@/components/loading"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FACETS, unresolved, type Facet, type Plan, type PlanAd, type ProposalSource, type Target } from "@/lib/campaign-builder/plan-schema"
import { BUILDABLE_FORMATS, FORMAT_LABEL, presetByKey, type AdFormat } from "@/lib/campaign-builder/presets"
import { money, shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { accountAudiences, accountLeadForms, buildFromPlan, imagePreview, imageUploadUrl, lookupTargeting, savePlan, type BuildOutcome } from "./actions"
import { usePlanPoll, type BuilderProps, type PlanRow } from "./builder-view"

const OBJECTIVES = ["BRAND_AWARENESS", "WEBSITE_VISIT", "ENGAGEMENT", "VIDEO_VIEW", "LEAD_GENERATION", "WEBSITE_CONVERSION"] as const
const CTAS = ["LEARN_MORE", "DOWNLOAD", "REGISTER", "SIGN_UP", "SUBSCRIBE", "REQUEST_DEMO", "APPLY", "VIEW_QUOTE", "ATTEND", "JOIN"] as const
export const words = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

/** Asks the planner to run again (after Claude's questions, or after fixing what made it fail). */
async function planAgain(planId: string, answers: Record<string, string>) {
  const r = await fetch("/api/campaign-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, answers }) })
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? null
}

/** One plan: Claude's questions (a pop-up, one per slide), then the plan to review, edit and build. */
export function PlanPanel(p: BuilderProps & { plan: PlanRow; onClose: () => void }) {
  const router = useRouter()
  const row = p.plan
  usePlanPoll(row.id, row.status === "planning", () => router.refresh())

  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="eyebrow">
            {row.mode === "abx" ? "ABX" : "General"} · {presetByKey(row.preset)?.label ?? row.preset}
          </div>
          <h2 className="truncate text-xl">{row.plan?.campaign.name ?? "New campaign"}</h2>
        </div>
        <Button variant="outline" size="sm" onClick={p.onClose}>
          New campaign
        </Button>
      </div>

      {row.status === "planning" && (
        <div className="flex items-center gap-3 px-4 py-6 text-sm text-muted-foreground">
          <Spinner label="Planning" /> Planning. About a minute.
        </div>
      )}
      {row.status === "failed" && <Failed row={row} canBuild={p.canBuild} />}
      {row.status === "questions" && row.questions.length > 0 && <Questions row={row} />}
      {row.plan && row.status !== "planning" && <PlanEditor key={row.id + (row.plan.campaign.name ?? "")} row={row} initial={row.plan} {...p} />}
    </section>
  )
}

export function Failed({ row, canBuild }: { row: Pick<PlanRow, "id" | "error">; canBuild: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const retry = async () => {
    setBusy(true)
    const e = await planAgain(row.id, {})
    setBusy(false)
    if (e) return setError(e)
    router.refresh()
  }
  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rag-red" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-rag-red">{error ?? row.error ?? "The plan failed."}</p>
      <Button size="sm" variant="outline" onClick={retry} disabled={busy || !canBuild}>
        {busy ? "Starting…" : "Try again"}
      </Button>
    </div>
  )
}

/** Claude's questions as a deck: one per slide, tap an answer or type one. Opens by itself. */
export function Questions({ row }: { row: Pick<PlanRow, "id" | "questions" | "answers"> }) {
  const qs = row.questions
  const [open, setOpen] = useState(true)
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>(row.answers)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const q = qs[Math.min(at, qs.length - 1)]
  const last = at >= qs.length - 1
  const answered = qs.filter((x) => answers[x.id]?.trim()).length

  const send = async () => {
    setBusy(true)
    setError(null)
    const e = await planAgain(row.id, answers)
    setBusy(false)
    if (e) return setError(e)
    setOpen(false)
    router.refresh()
  }
  const next = () => (last ? void send() : setAt(at + 1))
  const pick = (o: string) => {
    setAnswers({ ...answers, [q.id]: o })
    if (!last) setTimeout(() => setAt((i) => Math.min(i + 1, qs.length - 1)), 180)
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <span className="flex-1 text-[13px] text-body">
          {qs.length} question{qs.length === 1 ? "" : "s"} before the final plan{answered ? ` · ${answered} answered` : ""}
        </span>
        <Button size="sm" onClick={() => setOpen(true)}>
          Answer
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] gap-6 p-6 sm:max-w-lg">
          <div className="flex gap-1.5 pr-8" aria-hidden>
            {qs.map((x, j) => (
              <span key={x.id} className={cn("h-1 flex-1 rounded-full transition-colors", j <= at ? "bg-lime" : "bg-white/10")} />
            ))}
          </div>
          <div key={q.id} className="space-y-4 animate-in fade-in-0 slide-in-from-right-4 duration-200">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {at + 1} of {qs.length}
              </p>
              <DialogTitle className="font-sans text-lg leading-snug font-semibold">{q.question}</DialogTitle>
            </div>
            {q.options.length > 0 && (
              <div className="grid gap-2">
                {q.options.map((o) => {
                  const on = answers[q.id] === o
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => pick(o)}
                      aria-pressed={on}
                      className={cn("flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-lime focus-visible:outline-none", on && "border-lime/70 bg-white/[0.04] text-foreground")}
                    >
                      {o}
                      {on && <CheckIcon className="size-4 text-lime" aria-hidden />}
                    </button>
                  )
                })}
              </div>
            )}
            <Input
              aria-label="Your answer"
              value={q.options.includes(answers[q.id] ?? "") ? "" : (answers[q.id] ?? "")}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder={q.options.length ? "Or type your own" : "Your answer"}
              autoFocus={!q.options.length}
            />
          </div>
          {error && <p className="text-[13px] text-rag-red">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAt(at - 1)} disabled={at === 0} className={cn(at === 0 && "invisible")}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            <div className="flex gap-2">
              {!last && (
                <Button variant="outline" size="sm" onClick={() => setAt(at + 1)}>
                  Skip
                </Button>
              )}
              <Button size="sm" onClick={next} disabled={busy || (last && !answered)}>
                {last ? (busy ? "Planning…" : "Plan again") : "Next"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PlanEditor(p: BuilderProps & { row: PlanRow; initial: Plan }) {
  const [plan, setPlan] = useState<Plan>(p.initial)
  const [accountId, setAccountId] = useState(p.accounts[0]?.id ?? "")
  const [outcome, setOutcome] = useState<BuildOutcome | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  const m = (n: number) => money(n, p.currency, n % 1 ? 2 : 0)
  const c = plan.campaign
  const set = (patch: Partial<Plan["campaign"]>) => setPlan({ ...plan, campaign: { ...c, ...patch } })
  const setAd = (i: number, patch: Partial<PlanAd>) => setPlan({ ...plan, ads: plan.ads.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const locked = Boolean(p.row.buildId && p.builds.find((b) => b.id === p.row.buildId)?.status === "created")

  const save = () =>
    start(async () => {
      const r = await savePlan(p.row.id, plan)
      setSaved(r.ok ? "Saved" : (r.error ?? "Couldn't save."))
    })
  const build = () =>
    start(async () => {
      setOutcome(null)
      const s = await savePlan(p.row.id, plan)
      if (!s.ok) return setOutcome({ ok: false, leftOut: [], error: s.error })
      setOutcome(await buildFromPlan(p.row.id, accountId))
      router.refresh()
    })

  return (
    <div className="divide-y">
      <Overview plan={plan} m={m} />
      {plan.proposal && <Proposal proposal={plan.proposal} />}

      <Section title="Campaign">
        <dl className="divide-y rounded-md border">
          <Setting label="Campaign group" value={plan.group.name}>
            <Input aria-label="Campaign group" value={plan.group.name} onChange={(e) => setPlan({ ...plan, group: { ...plan.group, name: e.target.value } })} />
          </Setting>
          <Setting label="Campaign name" value={c.name}>
            <Input aria-label="Campaign name" value={c.name} onChange={(e) => set({ name: e.target.value })} />
          </Setting>
          <Setting label="Objective" value={words(c.objective)}>
            <select aria-label="Objective" className={fieldClass} value={c.objective} onChange={(e) => set({ objective: e.target.value as Plan["campaign"]["objective"] })}>
              {OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {words(o)}
                </option>
              ))}
            </select>
          </Setting>
          <Setting label="Audience" value={<AudienceSummary plan={plan} />}>
            <Audience slug={p.slug} plan={plan} setPlan={setPlan} accountId={accountId} mode={p.row.mode} />
          </Setting>
          <Setting label="Ad format" value={[...new Set(plan.ads.map((a) => FORMAT_LABEL[a.format as AdFormat]))].join(", ")} />
          <Setting label="Placement" value={c.offsiteDelivery ? "LinkedIn and LinkedIn Audience Network" : "LinkedIn only"}>
            <label className="flex items-center gap-2 text-[13px] text-body">
              <input type="checkbox" checked={c.offsiteDelivery} onChange={(e) => set({ offsiteDelivery: e.target.checked })} />
              LinkedIn Audience Network
            </label>
          </Setting>
          <Setting
            label="Budget and schedule"
            value={
              <>
                {m(c.dailyBudget)} a day <span className="text-muted-foreground">· about {m(c.dailyBudget * 30)} a month</span>
                <span className="block">
                  {shortDate(c.startDate)} – {c.endDate ? shortDate(c.endDate) : "no end date"}
                </span>
              </>
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Daily budget" id="pl-budget">
                <Input id="pl-budget" type="number" min={10} step="1" value={c.dailyBudget} onChange={(e) => set({ dailyBudget: Number(e.target.value) })} />
              </Field>
              <Field label="Start" id="pl-start">
                <Input id="pl-start" type="date" value={c.startDate} onChange={(e) => set({ startDate: e.target.value })} />
              </Field>
              <Field label="End" id="pl-end">
                <Input id="pl-end" type="date" value={c.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />
              </Field>
            </div>
          </Setting>
          <Setting label="Bidding" value={`Manual bid · ${m(c.bid)} ${c.costType === "CPC" ? "per click" : "per 1,000 impressions"}`}>
            <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
              <Field label="Pay per" id="pl-cost">
                <select id="pl-cost" className={fieldClass} value={c.costType} onChange={(e) => set({ costType: e.target.value as "CPC" | "CPM" })}>
                  <option value="CPC">Click (CPC)</option>
                  <option value="CPM">1,000 impressions (CPM)</option>
                </select>
              </Field>
              <Field label="Bid" id="pl-bid">
                <Input id="pl-bid" type="number" min={1} step="0.01" value={c.bid} onChange={(e) => set({ bid: Number(e.target.value) })} />
              </Field>
            </div>
          </Setting>
          {c.objective === "LEAD_GENERATION" && (
            <Setting label="Lead form" value={c.leadForm?.name ?? <span className="text-rag-amber">Not picked yet</span>} startOpen={!c.leadForm}>
              <LeadFormPicker slug={p.slug} accountId={accountId} value={c.leadForm} onChange={(leadForm) => set({ leadForm })} />
            </Setting>
          )}
        </dl>
      </Section>

      <Section title={`Ads · ${plan.ads.length}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          {plan.ads.map((ad, i) => (
            <AdCard key={i} slug={p.slug} ad={ad} leadGen={c.objective === "LEAD_GENERATION"} onChange={(patch) => setAd(i, patch)} />
          ))}
        </div>
      </Section>

      <Why plan={plan} />

      <div className="sticky bottom-0 space-y-3 bg-card px-4 py-3">
        {outcome && <Outcome outcome={outcome} live={p.buildLive} />}
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="LinkedIn ad account" className={cn(fieldClass, "w-auto")} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {!p.accounts.length && <option value="">No LinkedIn account mapped</option>}
            {p.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="flex-1 text-xs text-muted-foreground">{saved}</span>
          <Button variant="outline" onClick={save} disabled={pending || !p.canBuild || locked}>
            Save
          </Button>
          <Button onClick={build} disabled={pending || !p.canBuild || !accountId || locked} title={locked ? "This plan's campaign was created; edit it from the campaign list" : undefined}>
            {pending ? "Working…" : p.buildLive ? "Build paused in LinkedIn" : "Dry run"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The plan in one sentence, then the numbers that matter in one line. */
function Overview({ plan, m }: { plan: Plan; m: (n: number) => string }) {
  const c = plan.campaign
  const facts = [words(c.objective), `${m(c.dailyBudget)} a day`, `${c.costType} ${m(c.bid)}`, `from ${shortDate(c.startDate)}`, `${plan.ads.length} ad${plan.ads.length === 1 ? "" : "s"}`]
  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-[15px] leading-relaxed text-foreground">{plan.summary}</p>
      <p className="flex flex-wrap gap-1.5">
        {facts.map((f) => (
          <span key={f} className="pill">
            {f}
          </span>
        ))}
      </p>
      {plan.structure.length > 1 && (
        <ol className="space-y-1 text-[13px]">
          {plan.structure.map((s, i) => (
            <li key={i} className="flex min-w-0 gap-2">
              <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="truncate" title={s.purpose}>
                <span className="text-foreground">{s.name}</span> <span className="text-muted-foreground">{s.purpose}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Where the copy and images came from, and what to fix in Notion when something couldn't be used. */
export function Proposal({ proposal }: { proposal: ProposalSource }) {
  const used = proposal.images.filter((i) => i.path).length
  return (
    <div className="space-y-2 px-4 py-3 text-[13px]">
      <p className="flex flex-wrap items-center gap-x-2 text-body">
        From the Notion proposal
        <a href={proposal.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
          {proposal.title}
          <ExternalLink className="size-3" aria-hidden />
        </a>
        <span className="text-muted-foreground">
          · {used} of {proposal.images.length} image{proposal.images.length === 1 ? "" : "s"} used
        </span>
      </p>
      {proposal.problems.length > 0 && (
        <ul className="space-y-1 rounded-md bg-rag-amber-bg px-3 py-2 text-rag-amber">
          {proposal.problems.map((x) => (
            <li key={x} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {x}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 px-4 py-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

/** A Campaign Manager style row: the setting, its value, and a pencil that opens the editor in place. */
export function Setting({ label, value, children, startOpen = false }: { label: string; value: React.ReactNode; children?: React.ReactNode; startOpen?: boolean }) {
  const [editing, setEditing] = useState(startOpen)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-3 py-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
      <dt className="col-start-1 row-start-1 py-1 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="col-span-2 min-w-0 py-1 text-[13px] text-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">{editing && children ? children : value}</dd>
      {children ? (
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          aria-label={editing ? `Done editing ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`}
          aria-expanded={editing}
          className="col-start-2 row-start-1 grid size-7 place-items-center justify-self-end rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-lime focus-visible:outline-none sm:col-start-3"
        >
          {editing ? <CheckIcon className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
        </button>
      ) : (
        <span aria-hidden />
      )}
    </div>
  )
}

export function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

const facetsOf = (plan: Plan, side: "include" | "exclude") => Object.entries(plan.audience[side]).filter(([, list]) => list?.length) as [Facet, Target[]][]

/** The audience as LinkedIn lists it: each facet with its values. Values without LinkedIn's id yet are amber. */
function AudienceSummary({ plan }: { plan: Plan }) {
  const missing = unresolved(plan).length
  const rows = [...facetsOf(plan, "include").map(([f, l]) => [FACETS[f], l] as const), ...facetsOf(plan, "exclude").map(([f, l]) => [`Excluded: ${FACETS[f].toLowerCase()}`, l] as const)]
  if (!rows.length) return <span className="text-rag-amber">No targeting yet</span>
  return (
    <div className="space-y-1">
      {rows.map(([label, list]) => (
        <p key={label} className="flex gap-2">
          <span className="w-36 shrink-0 text-muted-foreground">{label.replace(/ \(.*\)$/, "")}</span>
          <span className="min-w-0">
            {list.map((t, i) => (
              <span key={`${t.name}-${i}`} className={cn(!t.urn && "text-rag-amber")}>
                {i > 0 && <span className="text-muted-foreground">, </span>}
                {t.name}
              </span>
            ))}
          </span>
        </p>
      ))}
      {missing > 0 && <p className="text-xs text-rag-amber">{missing} need LinkedIn&apos;s id: edit to look them up</p>}
    </div>
  )
}

function Audience({ slug, plan, setPlan, accountId, mode }: { slug: string; plan: Plan; setPlan: (p: Plan) => void; accountId: string; mode: "general" | "abx" }) {
  const update = (side: "include" | "exclude", facet: Facet, list: Target[]) => setPlan({ ...plan, audience: { ...plan.audience, [side]: { ...plan.audience[side], [facet]: list } } })
  const [adding, setAdding] = useState<Facet | "">("")
  return (
    <div className="space-y-3">
      {(["include", "exclude"] as const).map((side) => (
        <div key={side} className="space-y-2">
          {side === "exclude" && facetsOf(plan, "exclude").length > 0 && <h4 className="text-xs text-muted-foreground">Excluded</h4>}
          {facetsOf(plan, side).map(([facet, list]) => (
            <div key={facet} className="flex flex-wrap items-center gap-1.5">
              <span className="w-36 shrink-0 text-xs text-muted-foreground">{FACETS[facet].replace(/ \(.*\)$/, "")}</span>
              {list.map((t, i) => (
                <TargetChip key={`${t.name}-${i}`} slug={slug} facet={facet} value={t} accountId={accountId} onChange={(v) => update(side, facet, v ? list.map((x, j) => (j === i ? v : x)) : list.filter((_, j) => j !== i))} />
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <select aria-label="Add to the audience" className={cn(fieldClass, "w-auto")} value={adding} onChange={(e) => setAdding(e.target.value as Facet)}>
          <option value="">Add to the audience…</option>
          {(Object.keys(FACETS) as Facet[]).map((f) => (
            <option key={f} value={f}>
              {FACETS[f]}
            </option>
          ))}
        </select>
        {adding && (
          <Lookup
            slug={slug}
            facet={adding}
            accountId={accountId}
            autoOpen
            onPick={(t) => {
              update("include", adding, [...(plan.audience.include[adding] ?? []), t])
              setAdding("")
            }}
          />
        )}
      </div>
      {mode === "abx" && !plan.audience.include.audienceMatchingSegments?.length && <p className="text-xs text-rag-amber">ABX needs a company or contact list under Matched audiences.</p>}
    </div>
  )
}

function TargetChip({ slug, facet, value, accountId, onChange }: { slug: string; facet: Facet; value: Target; accountId: string; onChange: (v: Target | null) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <span className={cn("pill gap-1 font-medium", value.urn ? "text-body" : "border-rag-amber/50 text-rag-amber")}>
        <button type="button" onClick={() => setOpen(!open)} title={value.urn ?? "No LinkedIn id yet: click to look it up"} className="inline-flex items-center gap-1">
          {value.urn ? <CheckIcon className="size-3" aria-hidden /> : <Search className="size-3" aria-hidden />}
          {value.name}
        </button>
        <button type="button" aria-label={`Remove ${value.name}`} onClick={() => onChange(null)}>
          <X className="size-3" aria-hidden />
        </button>
      </span>
      {open && (
        <span className="absolute left-0 top-7 z-20">
          <Lookup
            slug={slug}
            facet={facet}
            accountId={accountId}
            initial={value.name}
            autoOpen
            onPick={(t) => {
              onChange(t)
              setOpen(false)
            }}
          />
        </span>
      )}
    </span>
  )
}

/** Looks a targeting value up in LinkedIn (read only); matched audiences come from the account's list. */
function Lookup({ slug, facet, accountId, initial = "", autoOpen, onPick }: { slug: string; facet: Facet; accountId: string; initial?: string; autoOpen?: boolean; onPick: (t: Target) => void }) {
  const [q, setQ] = useState(initial)
  const [results, setResults] = useState<{ name: string; urn: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const segments = facet === "audienceMatchingSegments"
  const [busy, setBusy] = useState(Boolean(segments && autoOpen))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!segments || !autoOpen) return
    accountAudiences(slug, accountId).then((r) => {
      setBusy(false)
      if (r.ok) setResults(r.audiences.map((a) => ({ name: `${a.name}${a.size ? ` (${a.size.toLocaleString("en-US")})` : ""}`, urn: a.urn })))
      else setError(r.error)
    })
  }, [segments, autoOpen, slug, accountId])

  const search = (text: string) => {
    setQ(text)
    if (segments) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setBusy(true)
      const r = await lookupTargeting(slug, facet, text)
      setBusy(false)
      if (r.ok) {
        setResults(r.results)
        setError(null)
      } else setError(r.error)
    }, 350)
  }
  const shown = segments ? results.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : results
  return (
    <span className="block w-80 rounded-md border bg-popover p-2 shadow-lg">
      <Input autoFocus value={q} onChange={(e) => search(e.target.value)} placeholder={segments ? "Filter the account's lists" : `Search ${FACETS[facet].toLowerCase()}`} />
      {busy && <span className="mt-2 block text-xs text-muted-foreground">Looking it up…</span>}
      {error && <span className="mt-2 block text-xs text-rag-amber">{error}</span>}
      <span className="mt-1 block max-h-56 overflow-y-auto">
        {shown.map((r) => (
          <button key={r.urn} type="button" className="block w-full truncate rounded px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.06]" onClick={() => onPick({ name: r.name, urn: r.urn })}>
            {r.name}
          </button>
        ))}
        {q.trim() && (
          <button type="button" className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/[0.06]" onClick={() => onPick({ name: q.trim(), urn: null })}>
            Add &ldquo;{q.trim()}&rdquo; without an id for now
          </button>
        )}
      </span>
    </span>
  )
}

/** An ad as it shows in the LinkedIn feed (intro text, image, headline and button), with a pencil to edit it. */
function AdCard({ slug, ad, leadGen, onChange }: { slug: string; ad: PlanAd; leadGen: boolean; onChange: (patch: Partial<PlanAd>) => void }) {
  const [editing, setEditing] = useState(false)
  const buildable = BUILDABLE_FORMATS.includes(ad.format as AdFormat)
  return (
    <div className="flex flex-col overflow-hidden rounded-md border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={ad.name}>
          {ad.name}
        </span>
        {ad.fromProposal && <span className="pill">Proposal</span>}
        <span className="pill">{buildable ? FORMAT_LABEL[ad.format as AdFormat] : `${FORMAT_LABEL[ad.format as AdFormat]}: build in LinkedIn`}</span>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          aria-label={editing ? `Done editing ${ad.name}` : `Edit ${ad.name}`}
          aria-expanded={editing}
          className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-lime focus-visible:outline-none"
        >
          {editing ? <CheckIcon className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
        </button>
      </div>
      {editing ? (
        <AdEditor slug={slug} ad={ad} leadGen={leadGen} onChange={onChange} />
      ) : (
        <div className="flex flex-1 flex-col">
          {ad.commentary && <p className="line-clamp-3 px-3 py-2.5 text-[13px] whitespace-pre-line text-body">{ad.commentary}</p>}
          {ad.format === "single_image" ? (
            <ImageSlot slug={slug} path={ad.imagePath} onChange={(imagePath) => onChange({ imagePath })} flush />
          ) : ad.format === "thought_leader" ? (
            <p className={cn("border-y px-3 py-6 text-center text-xs", ad.postUrn ? "text-muted-foreground" : "text-rag-amber")}>{ad.postUrn ? `Sponsors ${ad.postUrn}` : "No post picked yet"}</p>
          ) : (
            <p className="border-y px-3 py-6 text-center text-xs text-muted-foreground">{ad.creativeBrief || FORMAT_LABEL[ad.format as AdFormat]}</p>
          )}
          <div className="mt-auto flex items-center gap-3 bg-white/[0.03] px-3 py-2.5">
            <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold text-foreground">{ad.headline || <span className="font-normal text-muted-foreground">No headline</span>}</span>
            <span className="shrink-0 rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-foreground">{words(ad.callToAction)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function AdEditor({ slug, ad, leadGen, onChange }: { slug: string; ad: PlanAd; leadGen: boolean; onChange: (patch: Partial<PlanAd>) => void }) {
  return (
    <div className="space-y-2 p-3">
      <Input aria-label="Ad name" value={ad.name} onChange={(e) => onChange({ name: e.target.value })} />
      <div>
        <Textarea aria-label="Intro text" rows={4} value={ad.commentary} onChange={(e) => onChange({ commentary: e.target.value })} placeholder="Intro text" />
        <Count n={ad.commentary.length} soft={150} max={600} />
      </div>
      {ad.format !== "thought_leader" && (
        <div>
          <Input aria-label="Headline" value={ad.headline} onChange={(e) => onChange({ headline: e.target.value })} placeholder="Headline" />
          <Count n={ad.headline.length} soft={70} max={200} />
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
        <Input aria-label="Landing page" value={ad.landingUrl} onChange={(e) => onChange({ landingUrl: e.target.value })} placeholder={leadGen ? "Opens the lead form" : "Landing page"} disabled={leadGen} />
        <select aria-label="Call to action" className={fieldClass} value={ad.callToAction} onChange={(e) => onChange({ callToAction: e.target.value as PlanAd["callToAction"] })}>
          {CTAS.map((x) => (
            <option key={x} value={x}>
              {words(x)}
            </option>
          ))}
        </select>
      </div>
      {ad.format === "single_image" && <ImageSlot slug={slug} path={ad.imagePath} onChange={(imagePath) => onChange({ imagePath })} />}
      {ad.format === "thought_leader" && (
        <Input aria-label="Post to sponsor" defaultValue={ad.postUrn ?? ""} onChange={(e) => onChange({ postUrn: /^urn:li:(share|ugcPost):\d+$/.test(e.target.value.trim()) ? e.target.value.trim() : null })} placeholder="Post to sponsor: urn:li:share:…" />
      )}
      {ad.creativeBrief && !ad.imagePath && <p className="text-xs text-muted-foreground">Creative: {ad.creativeBrief}</p>}
    </div>
  )
}

export function Count({ n, soft, max }: { n: number; soft: number; max: number }) {
  return <span className={cn("mt-0.5 block text-right text-xs", n > max ? "text-rag-red" : n > soft ? "text-rag-amber" : "text-muted-foreground")}>{n} / {soft}</span>
}

export function ImageSlot({ slug, path, onChange, flush }: { slug: string; path: string | null; onChange: (path: string | null) => void; flush?: boolean }) {
  // The preview link belongs to the path it was made for, so a new upload never shows an old image.
  const [preview, setPreview] = useState<{ path: string; url: string | null } | null>(null)
  const url = path && preview?.path === path ? preview.url : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (path) imagePreview(slug, path).then((u) => setPreview({ path, url: u }))
  }, [slug, path])
  const upload = async (file: File) => {
    setError(null)
    if (file.size > 5 * 1024 * 1024) return setError("Images up to 5 MB.")
    setBusy(true)
    const s = await imageUploadUrl(slug, file.type)
    if (!s.ok) {
      setBusy(false)
      return setError(s.error)
    }
    const sb = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    const { error: e } = await sb.storage.from("campaign-assets").uploadToSignedUrl(s.path, s.token, file, { contentType: file.type })
    setBusy(false)
    if (e) return setError("The upload failed.")
    onChange(s.path)
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        title={path ? "Replace the image" : undefined}
        className={cn("flex aspect-[1.91/1] w-full items-center justify-center overflow-hidden text-xs hover:border-border-strong", flush ? "border-y" : "rounded-md border", !path && "border-dashed text-rag-amber", path && "text-muted-foreground")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="size-full object-cover" /> : busy ? "Uploading…" : path ? "Loading…" : "Upload image (1200×627)"}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {error && <p className="px-3 py-1 text-xs text-rag-red">{error}</p>}
    </div>
  )
}

/** Why it's planned this way: one line per reason with where it came from, the rest folded. */
export function Why({ plan }: { plan: Pick<Plan, "rationale" | "success" | "practices" | "risks"> }) {
  if (!plan.rationale.length && !plan.success && !plan.practices.length && !plan.risks.length) return null
  return (
    <Section title="Why this plan">
      <ul className="divide-y rounded-md border text-[13px]">
        {plan.rationale.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
            <span className="text-body">{r.point}</span>
            <span className="pill shrink-0">{r.source}</span>
          </li>
        ))}
        {plan.success && (
          <li className="flex gap-3 px-3 py-2">
            <span className="shrink-0 text-muted-foreground">Success</span>
            <span className="text-foreground">{plan.success}</span>
          </li>
        )}
      </ul>
      {(plan.risks.length > 0 || plan.practices.length > 0) && (
        <details className="group text-[13px]">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {[plan.risks.length ? `${plan.risks.length} risk${plan.risks.length === 1 ? "" : "s"}` : "", plan.practices.length ? `${plan.practices.length} playbook practice${plan.practices.length === 1 ? "" : "s"} followed` : ""].filter(Boolean).join(" · ")}
          </summary>
          <ul className="mt-2 space-y-1 pl-1">
            {plan.risks.map((x) => (
              <li key={x} className="flex gap-2 text-rag-amber">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {x}
              </li>
            ))}
            {plan.practices.map((x) => (
              <li key={x} className="flex gap-2 text-body">
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {x}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  )
}

export function Outcome({ outcome, live, platform = "LinkedIn", manager = "Campaign Manager" }: { outcome: BuildOutcome; live: boolean; platform?: string; manager?: string }) {
  const run = outcome.run
  return (
    <div className="space-y-2 rounded-md border p-3 text-[13px]">
      {outcome.error && !outcome.check?.errors.length && <p className="text-rag-red">{outcome.error}</p>}
      {run?.ok && <p className="text-rag-green">{run.live ? `Created in ${platform}, paused. Turn it on in ${manager} when it's ready.` : "Dry run done: every request was logged and nothing was sent."}</p>}
      {outcome.check?.errors.map((e) => (
        <p key={e} className="text-rag-red">
          {e}
        </p>
      ))}
      {outcome.check?.warnings.map((w) => (
        <p key={w} className="text-rag-amber">
          {w}
        </p>
      ))}
      {outcome.leftOut.length > 0 && <p className="text-muted-foreground">Left out: {outcome.leftOut.join("; ")}.</p>}
      {run && run.steps.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">{run.steps.length} steps</summary>
          <ol className="mt-1 space-y-0.5">
            {run.steps.map((s) => (
              <li key={s.key}>
                {s.key}: {s.operation.replace(/_/g, " ")} · {s.status === "dry_run" ? "logged" : s.status}
                {s.error ? ` (${s.error})` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
      {!live && !run && !outcome.error && <p className="text-muted-foreground">Nothing was sent.</p>}
    </div>
  )
}

/** Lead gen: the account's lead form every ad opens. Read from LinkedIn; Claude never picks it. */
function LeadFormPicker({ slug, accountId, value, onChange }: { slug: string; accountId: string; value: Target | null; onChange: (v: Target | null) => void }) {
  const [forms, setForms] = useState<{ name: string; urn: string; state: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState("")
  const load = async () => {
    setBusy(true)
    const r = await accountLeadForms(slug, accountId)
    setBusy(false)
    if (r.ok) setForms(r.forms)
    else setError(r.error)
  }
  return (
    <div className="space-y-1.5">
      {value ? (
        <div className="flex items-center gap-2 text-[13px]">
          <span className="pill font-medium text-body">{value.name}</span>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      ) : forms ? (
        <select
          aria-label="Lead form"
          className={fieldClass}
          value=""
          onChange={(e) => {
            const f = forms.find((x) => x.urn === e.target.value)
            if (f) onChange({ name: f.name, urn: f.urn })
          }}
        >
          <option value="">Pick the account&apos;s lead form…</option>
          {forms.map((f) => (
            <option key={f.urn} value={f.urn}>
              {f.name}
              {f.state && f.state !== "PUBLISHED" ? ` (${f.state.toLowerCase()})` : ""}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={busy || !accountId}>
            {busy ? "Reading forms…" : "Pick from LinkedIn"}
          </Button>
          <Input aria-label="Lead form URN" className="w-64" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="or paste urn:li:adForm:…" />
          <Button size="sm" variant="outline" disabled={!/^urn:li:adForm:\d+$/.test(manual.trim())} onClick={() => onChange({ name: manual.trim(), urn: manual.trim() })}>
            Use
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-rag-amber">{error}</p>}
    </div>
  )
}
