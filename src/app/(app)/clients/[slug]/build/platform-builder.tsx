"use client"

import { Building2, FileText, Film, Image as ImageIcon, Megaphone, Repeat, Sparkles, Target, UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { fieldClass } from "@/components/field-class"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BUILD_PLATFORM_LABEL, type OtherPlatform } from "@/lib/campaign-builder/platform-plan"
import { platformPresetByKey, presetsForPlatform } from "@/lib/campaign-builder/platform-presets"
import type { Preset } from "@/lib/campaign-builder/presets"
import { notionPageIdIn } from "@/lib/campaign-builder/proposal-link"
import { shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PlatformCampaigns } from "./platform-campaigns"
import { PlatformPlanPanel, type PlatformPanelProps, type PlatformPlanRow } from "./platform-plan-panel"

export type PlatformBuilderProps = Omit<PlatformPanelProps, "builds"> & {
  platform: OtherPlatform
  clientName: string
  aiReady: boolean
  editLive: boolean
  openPlanId: string | null
  /** A sprint test to plan for (from "Build in …" on the Sprint tab). */
  testId: string | null
  plans: PlatformPlanRow[]
  builds: { id: string; name: string; status: string; dryRunAt: string | null; planId: string | null }[]
  tests: { id: string; title: string }[]
}

const ICONS: Record<Preset["icon"], typeof Megaphone> = { megaphone: Megaphone, image: ImageIcon, file: FileText, film: Film, user: UserRound, target: Target, repeat: Repeat, building: Building2, sparkles: Sparkles }

const setParam = (key: string, value: string | null) => {
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(key, value)
  else url.searchParams.delete(key)
  window.history.replaceState(null, "", url)
}

/**
 * The campaign builder for Google Ads, Meta, Reddit and Microsoft Ads (Dean, 2026-10-21): the same
 * flow as LinkedIn's. Pick a preset, say what you want (or link the Notion proposal, or the sprint
 * test), Claude plans it, the team reviews and builds it paused. The platform's live campaigns can be
 * paused or edited underneath.
 */
export function PlatformBuilder(p: PlatformBuilderProps) {
  const [activeId, setActiveId] = useState<string | null>(p.openPlanId)
  const open = (id: string | null) => {
    setActiveId(id)
    setParam("plan", id)
  }
  const active = p.plans.find((x) => x.id === activeId) ?? null
  const name = BUILD_PLATFORM_LABEL[p.platform]
  return (
    <div className="space-y-8">
      {!p.buildLive && <p className="rounded-md bg-rag-amber-bg px-3 py-2 text-[13px] text-rag-amber">Test mode: builds and edits are dry runs. Nothing reaches {name}.</p>}
      {active ? <PlatformPlanPanel key={active.id} {...p} row={active} onClose={() => open(null)} /> : <NewPlatformCampaign key={p.platform} {...p} onStarted={open} />}
      <PlatformCampaigns slug={p.slug} platform={p.platform} currency={p.currency} canEdit={p.canBuild} editLive={p.editLive} />
      <PastPlans plans={p.plans} builds={p.builds} activeId={activeId} onOpen={open} />
    </div>
  )
}

function NewPlatformCampaign(p: PlatformBuilderProps & { onStarted: (id: string) => void }) {
  const presets = presetsForPlatform(p.platform)
  const [preset, setPreset] = useState(presets[0]?.key ?? "")
  const [request, setRequest] = useState("")
  const [proposal, setProposal] = useState("")
  const [testId, setTestId] = useState(p.testId && p.tests.some((t) => t.id === p.testId) ? p.testId : "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const name = BUILD_PLATFORM_LABEL[p.platform]

  const start = async () => {
    setBusy(true)
    setError(null)
    const r = await fetch("/api/campaign-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug, platform: p.platform, mode: "general", preset, request, proposal: proposal.trim() || null, sprintTestId: testId || null }),
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
          const Icon = ICONS[x.icon as Preset["icon"]] ?? Megaphone
          const on = x.key === preset
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => setPreset(x.key)}
              aria-pressed={on}
              title={x.description}
              className={cn("surface flex items-center gap-3 px-4 py-3 text-left transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime", on && "border-lime/60 bg-white/[0.04]")}
            >
              <Icon className={cn("size-5 shrink-0", on ? "text-lime" : "text-muted-foreground")} aria-hidden />
              <span className="min-w-0 text-sm font-medium text-foreground">{x.label}</span>
            </button>
          )
        })}
      </div>
      <div className="surface space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="pb-request">What do you want to run?</Label>
          <Textarea id="pb-request" rows={3} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={PLACEHOLDER[p.platform]} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pb-proposal">Proposal (optional)</Label>
          <Textarea id="pb-proposal" rows={notionPageIdIn(proposal) || !proposal ? 1 : 6} value={proposal} onChange={(e) => setProposal(e.target.value)} placeholder="Notion link (its ad copy and images are used), or paste the text" />
          {notionPageIdIn(proposal) && <p className="text-xs text-muted-foreground">Notion page: the ad copy and images come from it.</p>}
        </div>
        {p.tests.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="pb-test">For a sprint test (optional)</Label>
            <select id="pb-test" className={fieldClass} value={testId} onChange={(e) => setTestId(e.target.value)}>
              <option value="">None</option>
              {p.tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {!p.accounts.length && <p className="text-[13px] text-rag-amber">No {name} account is mapped for {p.clientName}. Map one on Admin first.</p>}
        {error && <p className="text-[13px] text-rag-red">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <Button onClick={start} disabled={busy || !p.canBuild || !p.aiReady || !p.accounts.length || !preset} title={!p.canBuild ? "Admins and GTM leads on this client build campaigns for now" : !p.aiReady ? "Claude isn't set up (ANTHROPIC_API_KEY)" : undefined}>
            {busy ? "Starting…" : "Plan it"}
          </Button>
        </div>
      </div>
    </section>
  )
}

const PLACEHOLDER: Record<OtherPlatform, string> = {
  google_ads: "e.g. A non-brand Search campaign for MSP DNS filtering in the US, $150 a day, from the converting search terms",
  meta: "e.g. Lead ads for the AI security report to the trial-signup lookalike in the US, $80 a day from Monday",
  reddit: "e.g. Promote the MSP post in r/msp and r/sysadmin, $50 a day for two weeks",
  microsoft_ads: "e.g. Mirror the Google brand and non-brand Search campaigns on Microsoft, $40 a day",
}

const STATUS: Record<PlatformPlanRow["status"], string> = { planning: "Planning", questions: "Questions", ready: "Ready to review", failed: "Failed" }

function PastPlans({ plans, builds, activeId, onOpen }: { plans: PlatformPlanRow[]; builds: PlatformBuilderProps["builds"]; activeId: string | null; onOpen: (id: string) => void }) {
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
                  <span className="block truncate text-sm text-foreground">{x.plan?.draft.campaign.name ?? platformPresetByKey(x.preset)?.label ?? x.preset}</span>
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
