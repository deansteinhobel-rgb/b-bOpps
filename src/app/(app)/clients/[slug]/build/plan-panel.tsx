"use client"

import { createClient as createSupabase } from "@supabase/supabase-js"
import { Check as CheckIcon, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { Spinner } from "@/components/loading"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FACETS, notBuildable, unresolved, type Facet, type Plan, type PlanAd, type Target } from "@/lib/campaign-builder/plan-schema"
import { BUILDABLE_FORMATS, FORMAT_LABEL, presetByKey, type AdFormat } from "@/lib/campaign-builder/presets"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { accountAudiences, accountLeadForms, buildFromPlan, imagePreview, imageUploadUrl, lookupTargeting, savePlan, type BuildOutcome } from "./actions"
import { usePlanPoll, type BuilderProps, type PlanRow } from "./builder-view"

const OBJECTIVES = ["BRAND_AWARENESS", "WEBSITE_VISIT", "ENGAGEMENT", "VIDEO_VIEW", "LEAD_GENERATION", "WEBSITE_CONVERSION"] as const
const CTAS = ["LEARN_MORE", "DOWNLOAD", "REGISTER", "SIGN_UP", "SUBSCRIBE", "REQUEST_DEMO", "APPLY", "VIEW_QUOTE", "ATTEND", "JOIN"] as const
const words = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

/** One plan: Claude's questions, then the plan to review, edit and build. */
export function PlanPanel(p: BuilderProps & { plan: PlanRow; onClose: () => void }) {
  const router = useRouter()
  const row = p.plan
  usePlanPoll(row.id, row.status === "planning", () => router.refresh())

  return (
    <section className="surface overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="eyebrow">
            {row.mode === "abx" ? "ABX" : "General"} · {presetByKey(row.preset)?.label ?? row.preset}
          </div>
          <h2 className="truncate text-xl">{row.plan?.campaign.name ?? "New campaign"}</h2>
          {row.request && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{row.request}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={p.onClose}>
          New campaign
        </Button>
      </div>

      {row.status === "planning" && (
        <div className="flex items-center gap-3 px-4 py-6 text-sm text-muted-foreground">
          <Spinner label="Planning" /> Claude is reading the brief, calls, LinkedIn numbers and the playbook. About a minute.
        </div>
      )}
      {row.status === "failed" && <p className="px-4 py-4 text-sm text-rag-red">{row.error ?? "The plan failed."} Start a new one, or try again in a minute.</p>}
      {row.status === "questions" && row.questions.length > 0 && <Questions row={row} />}
      {row.plan && row.status !== "planning" && <PlanEditor key={row.id + (row.plan.campaign.name ?? "")} row={row} initial={row.plan} {...p} />}
    </section>
  )
}

function Questions({ row }: { row: PlanRow }) {
  const [answers, setAnswers] = useState<Record<string, string>>(row.answers)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const send = async () => {
    setBusy(true)
    setError(null)
    const r = await fetch("/api/campaign-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: row.id, answers }) })
    const json = (await r.json().catch(() => ({}))) as { error?: string }
    setBusy(false)
    if (json.error) return setError(json.error)
    router.refresh()
  }
  return (
    <div className="space-y-4 border-b bg-white/[0.02] px-4 py-4">
      <div>
        <h3 className="text-sm font-semibold">A few things Claude couldn&apos;t find</h3>
        <p className="text-xs text-muted-foreground">The plan below uses its best guess for these. Answer what you can and it plans again.</p>
      </div>
      {row.questions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <Label htmlFor={`q-${q.id}`}>{q.question}</Label>
          {q.why && <p className="text-xs text-muted-foreground">{q.why}</p>}
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => (
                <button key={o} type="button" className={cn("pill", answers[q.id] === o && "pill-active")} onClick={() => setAnswers({ ...answers, [q.id]: o })}>
                  {o}
                </button>
              ))}
            </div>
          )}
          <Input id={`q-${q.id}`} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Your answer" />
        </div>
      ))}
      {error && <p className="text-[13px] text-rag-red">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={send} disabled={busy || !Object.values(answers).some((a) => a.trim())}>
          {busy ? "Sending…" : "Plan again with these"}
        </Button>
      </div>
    </div>
  )
}

function PlanEditor(p: BuilderProps & { row: PlanRow; initial: Plan }) {
  const [plan, setPlan] = useState<Plan>(p.initial)
  const [accountId, setAccountId] = useState(p.accounts[0]?.id ?? "")
  const [outcome, setOutcome] = useState<BuildOutcome | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  const m = (n: number) => money(n, p.currency)
  const c = plan.campaign
  const set = (patch: Partial<Plan["campaign"]>) => setPlan({ ...plan, campaign: { ...c, ...patch } })
  const setAd = (i: number, patch: Partial<PlanAd>) => setPlan({ ...plan, ads: plan.ads.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const missing = unresolved(plan)
  const briefOnly = notBuildable(plan)
  const locked = Boolean(p.row.buildId && p.builds.find((b) => b.id === p.row.buildId)?.status === "created")

  const save = () =>
    start(async () => {
      const r = await savePlan(p.row.id, plan)
      setSaved(r.ok ? "Saved." : (r.error ?? "Couldn't save."))
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
      <div className="space-y-3 px-4 py-4">
        <p className="prose-body text-sm">{plan.summary}</p>
        {plan.structure.length > 0 && (
          <ol className="space-y-1 text-[13px]">
            {plan.structure.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground">{i + 1}.</span>
                <span>
                  <span className="text-foreground">{s.name}</span> <span className="text-muted-foreground">· {s.purpose}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Block title="Campaign">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign group" id="pl-group">
            <Input id="pl-group" value={plan.group.name} onChange={(e) => setPlan({ ...plan, group: { ...plan.group, name: e.target.value } })} />
          </Field>
          <Field label="Campaign name" id="pl-name">
            <Input id="pl-name" value={c.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Objective" id="pl-obj">
            <select id="pl-obj" className={fieldClass} value={c.objective} onChange={(e) => set({ objective: e.target.value as Plan["campaign"]["objective"] })}>
              {OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {words(o)}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bid type" id="pl-cost">
              <select id="pl-cost" className={fieldClass} value={c.costType} onChange={(e) => set({ costType: e.target.value as "CPC" | "CPM" })}>
                <option value="CPC">CPC</option>
                <option value="CPM">CPM</option>
              </select>
            </Field>
            <Field label="Bid" id="pl-bid">
              <Input id="pl-bid" type="number" min={1} step="0.01" value={c.bid} onChange={(e) => set({ bid: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Daily budget" id="pl-budget" hint={`${m(c.dailyBudget * 30)} over 30 days`}>
            <Input id="pl-budget" type="number" min={10} step="1" value={c.dailyBudget} onChange={(e) => set({ dailyBudget: Number(e.target.value) })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start" id="pl-start">
              <Input id="pl-start" type="date" value={c.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </Field>
            <Field label="End (optional)" id="pl-end">
              <Input id="pl-end" type="date" value={c.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />
            </Field>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px] text-body">
          <input type="checkbox" checked={c.offsiteDelivery} onChange={(e) => set({ offsiteDelivery: e.target.checked })} />
          LinkedIn Audience Network
        </label>
        {c.objective === "LEAD_GENERATION" && <LeadFormPicker slug={p.slug} accountId={accountId} value={c.leadForm} onChange={(leadForm) => set({ leadForm })} />}
      </Block>

      <Block title="Audience" description={plan.audience.summary}>
        <Audience slug={p.slug} plan={plan} setPlan={setPlan} accountId={accountId} mode={p.row.mode} />
        {missing.length > 0 && <p className="mt-3 text-xs text-rag-amber">{missing.length} value{missing.length === 1 ? "" : "s"} still need LinkedIn&apos;s id (click to look up). A dry run works without; a live build doesn&apos;t.</p>}
      </Block>

      <Block title="Ads" description={briefOnly.length ? `${briefOnly.length} ${briefOnly.length === 1 ? "ad is" : "ads are"} a format the app can't build yet (${[...new Set(briefOnly.map((a) => FORMAT_LABEL[a.format as AdFormat]))].join(", ")}): brief and build ${briefOnly.length === 1 ? "it" : "them"} in Campaign Manager.` : undefined}>
        <div className="space-y-4">
          {plan.ads.map((ad, i) => (
            <AdEditor key={i} slug={p.slug} ad={ad} leadGen={c.objective === "LEAD_GENERATION"} onChange={(patch) => setAd(i, patch)} />
          ))}
        </div>
      </Block>

      <Block title="Why it's planned this way">
        <ul className="space-y-1.5 text-[13px]">
          {plan.rationale.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="pill shrink-0">{r.source}</span>
              <span className="prose-body">{r.point}</span>
            </li>
          ))}
        </ul>
        {plan.practices.length > 0 && (
          <div className="mt-3">
            <h4 className="text-xs text-muted-foreground">Playbook followed</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-body">
              {plan.practices.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.risks.length > 0 && (
          <div className="mt-3">
            <h4 className="text-xs text-muted-foreground">Risks</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-body">
              {plan.risks.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.success && <p className="mt-3 text-[13px] text-body">Success: {plan.success}</p>}
      </Block>

      <div className="sticky bottom-0 space-y-3 bg-card px-4 py-4">
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

function Block({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mb-3 mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      <div className={description ? "" : "mt-3"}>{children}</div>
    </div>
  )
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Audience({ slug, plan, setPlan, accountId, mode }: { slug: string; plan: Plan; setPlan: (p: Plan) => void; accountId: string; mode: "general" | "abx" }) {
  const facets = (side: "include" | "exclude") => Object.entries(plan.audience[side]).filter(([, list]) => list?.length) as [Facet, Target[]][]
  const update = (side: "include" | "exclude", facet: Facet, list: Target[]) => setPlan({ ...plan, audience: { ...plan.audience, [side]: { ...plan.audience[side], [facet]: list } } })
  const [adding, setAdding] = useState<Facet | "">("")
  return (
    <div className="space-y-3">
      {(["include", "exclude"] as const).map((side) => (
        <div key={side} className="space-y-2">
          {side === "exclude" && facets("exclude").length > 0 && <h4 className="text-xs text-muted-foreground">Excluded</h4>}
          {facets(side).map(([facet, list]) => (
            <div key={facet} className="flex flex-wrap items-center gap-1.5">
              <span className="w-40 shrink-0 text-xs text-muted-foreground">{FACETS[facet]}</span>
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
      {mode === "abx" && !plan.audience.include.audienceMatchingSegments?.length && <p className="text-xs text-rag-amber">ABX campaigns target a company or contact list: add one under Matched audiences.</p>}
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

function AdEditor({ slug, ad, leadGen, onChange }: { slug: string; ad: PlanAd; leadGen: boolean; onChange: (patch: Partial<PlanAd>) => void }) {
  const buildable = BUILDABLE_FORMATS.includes(ad.format as AdFormat)
  return (
    <div className={cn("rounded-md border p-3", !buildable && "opacity-80")}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="pill">{FORMAT_LABEL[ad.format as AdFormat]}</span>
        {ad.variable && <span className="text-xs text-muted-foreground">Tests: {ad.variable}</span>}
        {!buildable && <span className="text-xs text-muted-foreground">Built in Campaign Manager</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="space-y-2">
          <Input aria-label="Ad name" value={ad.name} onChange={(e) => onChange({ name: e.target.value })} />
          <div>
            <Textarea aria-label="Intro text" rows={3} value={ad.commentary} onChange={(e) => onChange({ commentary: e.target.value })} placeholder="Intro text" />
            <Count n={ad.commentary.length} soft={150} max={600} />
          </div>
          {ad.format !== "thought_leader" && (
            <div>
              <Input aria-label="Headline" value={ad.headline} onChange={(e) => onChange({ headline: e.target.value })} placeholder="Headline" />
              <Count n={ad.headline.length} soft={70} max={200} />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
            <Input aria-label="Landing page" value={ad.landingUrl} onChange={(e) => onChange({ landingUrl: e.target.value })} placeholder={leadGen ? "Not needed: the ad opens the lead form" : "https://… (the client's site)"} disabled={leadGen} />
            <select aria-label="Call to action" className={fieldClass} value={ad.callToAction} onChange={(e) => onChange({ callToAction: e.target.value as PlanAd["callToAction"] })}>
              {CTAS.map((x) => (
                <option key={x} value={x}>
                  {words(x)}
                </option>
              ))}
            </select>
          </div>
          {ad.creativeBrief && <p className="text-xs text-muted-foreground">Creative: {ad.creativeBrief}</p>}
        </div>
        <div>
          {ad.format === "single_image" && <ImageSlot slug={slug} path={ad.imagePath} onChange={(imagePath) => onChange({ imagePath })} />}
          {ad.format === "thought_leader" && (
            <div className="space-y-1.5">
              <Label htmlFor={`post-${ad.name}`}>Post to sponsor</Label>
              <Input id={`post-${ad.name}`} value={ad.postUrn ?? ""} onChange={(e) => onChange({ postUrn: /^urn:li:(share|ugcPost):\d+$/.test(e.target.value.trim()) ? e.target.value.trim() : null })} placeholder="urn:li:share:…" />
              <p className="text-xs text-muted-foreground">The post&apos;s URN, from its embed code or Campaign Manager.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Count({ n, soft, max }: { n: number; soft: number; max: number }) {
  return <span className={cn("mt-0.5 block text-right text-xs", n > max ? "text-rag-red" : n > soft ? "text-rag-amber" : "text-muted-foreground")}>{n} / {soft}</span>
}

function ImageSlot({ slug, path, onChange }: { slug: string; path: string | null; onChange: (path: string | null) => void }) {
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
    <div className="space-y-1.5">
      <button type="button" onClick={() => input.current?.click()} className="flex aspect-[1.91/1] w-full items-center justify-center overflow-hidden rounded-md border border-dashed text-xs text-muted-foreground hover:border-border-strong">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="size-full object-cover" /> : busy ? "Uploading…" : "Upload image (1200×627)"}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {error && <p className="text-xs text-rag-red">{error}</p>}
    </div>
  )
}

function Outcome({ outcome, live }: { outcome: BuildOutcome; live: boolean }) {
  const run = outcome.run
  return (
    <div className="space-y-2 rounded-md border p-3 text-[13px]">
      {outcome.error && !outcome.check?.errors.length && <p className="text-rag-red">{outcome.error}</p>}
      {run?.ok && <p className="text-rag-green">{run.live ? "Created in LinkedIn, paused. Turn it on in Campaign Manager when it's ready." : "Dry run done: every request was logged and nothing was sent."}</p>}
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
      {outcome.leftOut.length > 0 && <p className="text-muted-foreground">Left out of this build: {outcome.leftOut.join("; ")}.</p>}
      {run && run.steps.length > 0 && (
        <ol className="space-y-0.5 text-xs text-muted-foreground">
          {run.steps.map((s) => (
            <li key={s.key}>
              {s.key}: {s.operation.replace(/_/g, " ")} · {s.status === "dry_run" ? "logged" : s.status}
              {s.error ? ` (${s.error})` : ""}
            </li>
          ))}
        </ol>
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
    <div className="mt-4 space-y-1.5">
      <Label htmlFor="pl-form">Lead form</Label>
      {value ? (
        <div className="flex items-center gap-2 text-[13px]">
          <span className="pill font-medium text-body">{value.name}</span>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      ) : forms ? (
        <select id="pl-form" className={fieldClass} value="" onChange={(e) => {
          const f = forms.find((x) => x.urn === e.target.value)
          if (f) onChange({ name: f.name, urn: f.urn })
        }}>
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
          <Input id="pl-form" className="w-64" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="or paste urn:li:adForm:…" />
          <Button size="sm" variant="outline" disabled={!/^urn:li:adForm:\d+$/.test(manual.trim())} onClick={() => onChange({ name: manual.trim(), urn: manual.trim() })}>
            Use
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-rag-amber">{error}</p>}
      {!value && <p className="text-xs text-muted-foreground">Lead gen ads open a LinkedIn lead form instead of a landing page. Build the form in Campaign Manager first.</p>}
    </div>
  )
}
