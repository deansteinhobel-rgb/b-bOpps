"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusDot } from "@/components/status-badge"
import type { EditResult } from "@/lib/ads-api/edit"
import type { HistoryCampaign } from "@/lib/campaign-builder/history"
import type { BuilderMode } from "@/lib/campaign-builder/presets"
import { money, shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { editLiveCampaign, liveCampaign, type LiveCampaignInfo } from "./actions"

const RUNNING = new Set(["ACTIVE", "ENABLED", "RUNNING"])

/** The view's LinkedIn campaigns with spend in the last 90 days, newest spend first, each with Pause and Edit. */
export function CampaignsTable(p: { slug: string; mode: BuilderMode; campaigns: HistoryCampaign[]; currency: string; target: number | null; historyTo: string | null; canEdit: boolean; editLive: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const m = (n: number) => money(n, p.currency)
  const rows = showAll ? p.campaigns : p.campaigns.filter((c) => c.spend30 > 0).slice(0, 25)
  const tone = (c: HistoryCampaign) => {
    if (p.target === null || !c.spend30) return null
    if (!c.results30) return "red" as const
    const cpr = c.spend30 / c.results30
    return cpr <= p.target ? ("green" as const) : cpr <= p.target * 1.2 ? ("amber" as const) : ("red" as const)
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl">{p.mode === "abx" ? "ABX campaigns" : "General campaigns"}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Last 30 days{p.historyTo ? ` to ${shortDate(p.historyTo)}` : ""}. {p.mode === "abx" ? "Account-based by name (ABM, ABX, target or prospect lists)." : "Everything that isn't account-based."}
          </p>
        </div>
        {p.campaigns.length > rows.length && (
          <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setShowAll(true)}>
            Show all {p.campaigns.length}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="surface px-4 py-6 text-sm text-muted-foreground">No {p.mode === "abx" ? "account-based" : "general"} LinkedIn campaigns spent in the last 30 days.</p>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 font-normal">Campaign</th>
                <th className="px-3 py-2 text-right font-normal">Spend</th>
                <th className="px-3 py-2 text-right font-normal">Results</th>
                <th className="px-3 py-2 text-right font-normal">Cost per result</th>
                <th className="px-3 py-2 text-right font-normal">CTR</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => {
                const t = tone(c)
                return (
                  <tr key={c.id}>
                    <td className="max-w-[28rem] px-4 py-2.5">
                      <span className="block truncate text-foreground" title={c.name}>
                        {c.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{c.status ? c.status.toLowerCase().replace(/^\w/, (x) => x.toUpperCase()) : "Status unknown"} · last spend {shortDate(c.lastDay)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m(c.spend30)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{Math.round(c.results30)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {t && <StatusDot status={t} />}
                        {c.results30 ? m(c.spend30 / c.results30) : "–"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.impressions ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : "–"}</td>
                    <td className="px-4 py-2.5 text-right">{p.canEdit && <EditCampaign slug={p.slug} campaign={c} currency={p.currency} running={RUNNING.has((c.status ?? "").toUpperCase())} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Pause, or change the daily budget, end date or name. Shows LinkedIn's values before and what changes. */
function EditCampaign({ slug, campaign, currency, running }: { slug: string; campaign: HistoryCampaign; currency: string; running: boolean }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<LiveCampaignInfo | null>(null)
  const [budget, setBudget] = useState("")
  const [end, setEnd] = useState("")
  const [name, setName] = useState(campaign.name)
  const [result, setResult] = useState<EditResult | null>(null)
  const [pending, start] = useTransition()
  const m = (n: number) => money(n, currency)

  const openDialog = () => {
    setOpen(true)
    setResult(null)
    start(async () => {
      const r = await liveCampaign(slug, campaign.id)
      setInfo(r)
      if (r.ok && r.before) {
        setBudget(r.before.dailyBudget ? String(r.before.dailyBudget) : "")
        setEnd(r.before.end ?? "")
        setName(r.before.name || campaign.name)
      }
    })
  }
  const before = info?.ok ? info.before : null
  const send = (kind: "pause" | "update") =>
    start(async () => {
      if (kind === "pause") return setResult(await editLiveCampaign(slug, campaign.id, { kind: "pause" }))
      const change: { kind: "update"; dailyBudget?: number; endDate?: string | null; name?: string } = { kind: "update" }
      if (budget && Number(budget) !== before?.dailyBudget) change.dailyBudget = Number(budget)
      if ((end || null) !== (before?.end ?? null)) change.endDate = end || null
      if (name.trim() && name.trim() !== (before?.name || campaign.name)) change.name = name.trim()
      if (Object.keys(change).length === 1) return setResult({ ok: false, live: false, lines: [], error: "Nothing changed." })
      setResult(await editLiveCampaign(slug, campaign.id, change))
    })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={openDialog}>
        {running ? "Pause or edit" : "Edit"}
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{campaign.name}</DialogTitle>
          <DialogDescription>Each change is logged with the value before it, in Admin → Activity. Lumaux never turns a campaign on, removes or deletes one.</DialogDescription>
        </DialogHeader>
        {pending && !info && <p className="text-xs text-muted-foreground">Reading the campaign from LinkedIn…</p>}
        {info && !info.ok && <p className="text-[13px] text-rag-red">{info.error}</p>}
        {info?.ok && (
          <div className="space-y-4">
            {!info.live && <p className="rounded-md bg-rag-amber-bg px-3 py-2 text-xs text-rag-amber">Test mode: the change is logged and nothing reaches LinkedIn.{info.reason && !info.reason.startsWith("ADS_API") ? ` ${info.reason}` : ""}</p>}
            {before && (
              <p className="text-xs text-muted-foreground">
                Now: {before.status.toLowerCase()} · {before.dailyBudget ? `${m(before.dailyBudget)} a day` : "no daily budget"} · {before.end ? `ends ${shortDate(before.end)}` : "no end date"}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="e-budget">Daily budget</Label>
                <Input id="e-budget" type="number" min={10} value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-end">End date</Label>
                <Input id="e-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-name">Name</Label>
              <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {result && (
              <div className={cn("rounded-md border p-3 text-[13px]", result.ok ? "text-rag-green" : "text-rag-red")}>
                {result.error ?? (result.live ? "Done in LinkedIn." : "Logged (test mode). Nothing was sent.")}
                {result.lines.length > 0 && (
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {result.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => send("pause")} disabled={pending || before?.status === "PAUSED"}>
                Pause campaign
              </Button>
              <Button onClick={() => send("update")} disabled={pending}>
                Save changes
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
