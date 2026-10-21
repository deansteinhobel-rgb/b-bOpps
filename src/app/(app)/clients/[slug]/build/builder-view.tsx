"use client"

import { Building2, FileText, Film, Image as ImageIcon, Megaphone, Repeat, Sparkles, Target, UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { fieldClass } from "@/components/field-class"
import type { PlaybookRule } from "@/lib/campaign-builder/guardrails"
import type { HistoryCampaign } from "@/lib/campaign-builder/history"
import type { NamingConvention } from "@/lib/campaign-builder/naming"
import type { Plan, Question } from "@/lib/campaign-builder/plan-schema"
import { presetByKey, presetsFor, type BuilderMode, type Preset } from "@/lib/campaign-builder/presets"
import type { Playbook } from "@/lib/campaign-builder/playbook"
import { shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CampaignsTable } from "./campaigns-table"
import { PlanPanel } from "./plan-panel"
import { PlaybookPanel } from "./playbook-panel"

export type PlanRow = {
  id: string
  mode: BuilderMode
  preset: string
  request: string
  status: "planning" | "questions" | "ready" | "failed"
  questions: Question[]
  answers: Record<string, string>
  plan: Plan | null
  error: string | null
  buildId: string | null
  createdAt: string
  by: string | null
}
export type BuildRow = { id: string; name: string; status: string; mode: BuilderMode; error: string | null; dryRunAt: string | null; createdIds: Record<string, string>; createdAt: string; planId: string | null }

export type BuilderProps = {
  slug: string
  clientName: string
  currency: string
  website: string | null
  mode: BuilderMode
  openPlanId: string | null
  canBuild: boolean
  isAdmin: boolean
  aiReady: boolean
  buildLive: boolean
  editLive: boolean
  target: number | null
  accounts: { id: string; name: string }[]
  campaigns: HistoryCampaign[]
  historyTo: string | null
  plans: PlanRow[]
  builds: BuildRow[]
  rules: PlaybookRule[]
  playbook: Playbook | null
  naming: NamingConvention | null
  tests: { id: string; title: string }[]
}

const ICONS: Record<Preset["icon"], typeof Megaphone> = { megaphone: Megaphone, image: ImageIcon, file: FileText, film: Film, user: UserRound, target: Target, repeat: Repeat, building: Building2, sparkles: Sparkles }

/** Keeps a URL param in sync without a server round trip (the Summary panel pattern). */
const setParam = (key: string, value: string | null) => {
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(key, value)
  else url.searchParams.delete(key)
  window.history.replaceState(null, "", url)
}

export function BuilderView(p: BuilderProps) {
  const [mode, setMode] = useState<BuilderMode>(p.mode)
  const [activeId, setActiveId] = useState<string | null>(p.openPlanId ?? null)
  const changeMode = (m: BuilderMode) => {
    setMode(m)
    setParam("view", m === "abx" ? "abx" : null)
  }
  const open = (id: string | null) => {
    setActiveId(id)
    setParam("plan", id)
  }
  const active = p.plans.find((x) => x.id === activeId) ?? null
  const inView = p.campaigns.filter((c) => c.abx === (mode === "abx"))

  return (
    <div className="space-y-8">
      <PageHeader
        title="Campaign builder"
        description={mode === "abx" ? "Account-based LinkedIn campaigns: target account and contact lists, the buying committee, engaged accounts." : "LinkedIn campaigns built from what Lumaux knows about the client, its numbers and this month's playbook."}
        actions={
          <Segmented
            label="View"
            value={mode}
            onChange={changeMode}
            options={[
              { value: "general", label: "General", count: p.campaigns.filter((c) => !c.abx).length },
              { value: "abx", label: "ABX", count: p.campaigns.filter((c) => c.abx).length },
            ]}
          />
        }
      />

      {!p.buildLive && (
        <p className="rounded-md bg-rag-amber-bg px-3 py-2 text-[13px] text-rag-amber">
          Test mode: builds and edits are logged as dry runs, with the exact requests, and nothing reaches LinkedIn. Everything the app creates starts paused.
        </p>
      )}

      {active ? (
        <PlanPanel key={active.id} plan={active} {...p} onClose={() => open(null)} />
      ) : (
        <NewCampaign key={mode} {...p} mode={mode} onStarted={open} />
      )}

      <CampaignsTable slug={p.slug} mode={mode} campaigns={inView} currency={p.currency} target={p.target} historyTo={p.historyTo} canEdit={p.canBuild} editLive={p.editLive} />

      <PastPlans plans={p.plans.filter((x) => x.mode === mode)} builds={p.builds} activeId={activeId} onOpen={open} />

      <PlaybookPanel slug={p.slug} rules={p.rules} playbook={p.playbook} naming={p.naming} canEdit={p.canBuild} isAdmin={p.isAdmin} />
    </div>
  )
}

function NewCampaign(p: BuilderProps & { onStarted: (id: string) => void }) {
  const presets = presetsFor(p.mode)
  const [preset, setPreset] = useState(presets[0].key)
  const [request, setRequest] = useState("")
  const [proposal, setProposal] = useState("")
  const [showProposal, setShowProposal] = useState(false)
  const [testId, setTestId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const start = async () => {
    setBusy(true)
    setError(null)
    const r = await fetch("/api/campaign-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, mode: p.mode, preset, request, proposal: proposal.trim() || null, sprintTestId: testId || null }),
    })
    const json = (await r.json().catch(() => ({}))) as { planId?: string; error?: string }
    setBusy(false)
    if (!json.planId) return setError(json.error ?? "Couldn't start the plan.")
    router.refresh()
    p.onStarted(json.planId)
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {presets.map((x) => {
          const Icon = ICONS[x.icon]
          const on = x.key === preset
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => setPreset(x.key)}
              aria-pressed={on}
              className={cn("surface flex items-start gap-3 px-4 py-3.5 text-left transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime", on && "border-lime/60 bg-white/[0.04]")}
            >
              <Icon className={cn("mt-0.5 size-5 shrink-0", on ? "text-lime" : "text-muted-foreground")} aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{x.label}</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">{x.description}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="surface space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="b-request">What do you want to run?</Label>
          <Textarea id="b-request" rows={3} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={p.mode === "abx" ? "e.g. The PE contact list, the OIG audit document ad, $60 a day from 3 Nov" : "e.g. Lead gen for the AI security report to IT directors in the US, from next Monday"} />
          <p className="text-xs text-muted-foreground">Claude reads the client brief, Notion HQ, calls, sprint tests, the LinkedIn numbers and the playbook, and only asks what it can&apos;t find.</p>
        </div>
        {showProposal ? (
          <div className="space-y-1.5">
            <Label htmlFor="b-proposal">Proposal or brief</Label>
            <Textarea id="b-proposal" rows={8} value={proposal} onChange={(e) => setProposal(e.target.value)} placeholder="Paste the proposal, brief or plan. Whatever it answers isn't asked." />
          </div>
        ) : (
          <button type="button" className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setShowProposal(true)}>
            + Paste a proposal or brief
          </button>
        )}
        {p.tests.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="b-test">For a sprint test (optional)</Label>
            <select id="b-test" className={fieldClass} value={testId} onChange={(e) => setTestId(e.target.value)}>
              <option value="">None</option>
              {p.tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="text-[13px] text-rag-red">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{presetByKey(preset)?.label}. About a minute.</p>
          <Button onClick={start} disabled={busy || !p.canBuild || !p.aiReady} title={!p.canBuild ? "Admins and GTM leads on this client build campaigns for now" : !p.aiReady ? "Claude isn't set up (ANTHROPIC_API_KEY)" : undefined}>
            {busy ? "Starting…" : "Plan it"}
          </Button>
        </div>
      </div>
    </section>
  )
}

const STATUS: Record<PlanRow["status"], string> = { planning: "Planning", questions: "Questions", ready: "Ready to review", failed: "Failed" }

function PastPlans({ plans, builds, activeId, onOpen }: { plans: PlanRow[]; builds: BuildRow[]; activeId: string | null; onOpen: (id: string) => void }) {
  if (!plans.length) return null
  return (
    <section className="space-y-3">
      <h2 className="text-xl">Plans</h2>
      <ul className="surface divide-y">
        {plans.map((x) => {
          const build = builds.find((b) => b.id === x.buildId)
          return (
            <li key={x.id}>
              <button type="button" onClick={() => onOpen(x.id)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]", x.id === activeId && "bg-white/[0.05]")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{x.plan?.campaign.name ?? presetByKey(x.preset)?.label ?? x.preset}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {shortDate(x.createdAt.slice(0, 10))}
                    {x.by ? ` · ${x.by}` : ""}
                    {x.request ? ` · ${x.request}` : ""}
                  </span>
                </span>
                <span className="pill">{build ? (build.status === "created" ? "Created, paused" : build.dryRunAt && build.status === "draft" ? "Dry run" : build.status.replace("_", " ")) : STATUS[x.status]}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Polls a plan while Claude works on it. */
export function usePlanPoll(planId: string, planning: boolean, onDone: () => void) {
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    if (!planning) return
    let stop = false
    const tick = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 3000))
        const r = await fetch(`/api/campaign-plan?plan=${planId}`).catch(() => null)
        const json = r ? ((await r.json().catch(() => null)) as { status?: string } | null) : null
        if (json?.status && json.status !== "planning") {
          done.current()
          return
        }
      }
    }
    void tick()
    return () => {
      stop = true
    }
  }, [planId, planning])
}
