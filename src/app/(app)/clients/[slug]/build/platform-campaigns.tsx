"use client"

import { Pencil } from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { Spinner } from "@/components/loading"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { EDITS, type PlatformChange } from "@/lib/ads-api/platform-edit"
import { BUILD_PLATFORM_LABEL, type OtherPlatform } from "@/lib/campaign-builder/platform-plan"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { applyPlatformEdit, platformCampaigns, previewPlatformEdit } from "./platform-actions"
import { Field } from "./plan-panel"

type Campaign = Awaited<ReturnType<typeof platformCampaigns>>[number]
const RUNNING = new Set(["ACTIVE", "ENABLED", "RUNNING"])

const KIND_LABEL: Record<PlatformChange["kind"], string> = {
  pause: "Pause the campaign",
  budget: "Change the daily budget",
  rename: "Rename",
  pause_ad_set: "Pause an ad set",
  ad_set_end: "Set an ad set's end date",
  targeting: "Fix an ad set's targeting",
  keywords: "Add keywords",
}

/**
 * The platform's campaigns from our own data (last 30 days), each with Pause and edits (Dean,
 * 2026-10-21). Every change is read from the platform first, shown before → after, logged, then sent
 * (a dry run until the switches are on). Nothing here turns anything on, removes or deletes.
 */
export function PlatformCampaigns(p: { slug: string; platform: OtherPlatform; currency: string; canEdit: boolean; editLive: boolean }) {
  const [list, setList] = useState<Campaign[] | null>(null)
  const [editing, setEditing] = useState<Campaign | null>(null)
  useEffect(() => {
    let live = true
    platformCampaigns(p.slug, p.platform).then((r) => live && setList(r))
    return () => {
      live = false
    }
  }, [p.slug, p.platform])
  const m = (n: number) => money(n, p.currency)
  const name = BUILD_PLATFORM_LABEL[p.platform]
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl">Campaigns in {name}</h2>
        <span className="text-xs text-muted-foreground">Last 30 days</span>
      </div>
      {list === null ? (
        <div className="surface flex items-center gap-3 px-4 py-4 text-sm text-muted-foreground">
          <Spinner label="Loading campaigns" /> Loading campaigns…
        </div>
      ) : !list.length ? (
        <p className="surface px-4 py-4 text-sm text-muted-foreground">No {name} campaigns with spend in the last 30 days.</p>
      ) : (
        <ul className="surface divide-y">
          {list.map((c) => {
            const running = RUNNING.has((c.status ?? "").toUpperCase())
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn("size-2 shrink-0 rounded-full", running ? "bg-rag-green" : "bg-white/20")} title={c.status ?? "Status unknown"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground" title={c.name}>
                    {c.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {m(c.spend30)} · {Math.round(c.results30)} result{Math.round(c.results30) === 1 ? "" : "s"}
                    {c.results30 > 0 ? ` · ${m(c.spend30 / c.results30)} each` : ""}
                  </span>
                </span>
                {p.canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editing && <EditDialog {...p} campaign={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function EditDialog(p: { slug: string; platform: OtherPlatform; currency: string; editLive: boolean; campaign: Campaign; onClose: () => void }) {
  const kinds = EDITS[p.platform].filter((k) => k !== "keywords" && (p.platform !== "meta" || !["pause_ad_set", "ad_set_end", "targeting"].includes(k) || (p.campaign.adSets ?? []).length > 0))
  const [kind, setKind] = useState<PlatformChange["kind"]>(kinds[0])
  const [budget, setBudget] = useState("")
  const [name, setName] = useState(p.campaign.name)
  const [adSetId, setAdSetId] = useState(p.campaign.adSets?.[0]?.id ?? "")
  const [endDate, setEndDate] = useState("")
  const [fix, setFix] = useState<"audience_network_off" | "advantage_off" | "ages">("audience_network_off")
  const [ages, setAges] = useState({ ageMin: 25, ageMax: 65 })
  const [preview, setPreview] = useState<{ ok: boolean; live: boolean; lines: string[]; error?: string } | null>(null)
  const [result, setResult] = useState<{ ok: boolean; live: boolean; lines: string[]; error?: string } | null>(null)
  const [pending, start] = useTransition()
  const platformName = BUILD_PLATFORM_LABEL[p.platform]

  const change = (): PlatformChange | null => {
    switch (kind) {
      case "pause":
        return { kind }
      case "budget":
        return Number(budget) > 0 ? { kind, dailyBudget: Number(budget), ...(p.platform === "meta" && adSetId ? { adSetId } : {}) } : null
      case "rename":
        return name.trim() ? { kind, name: name.trim() } : null
      case "pause_ad_set":
        return adSetId ? { kind, adSetId } : null
      case "ad_set_end":
        return adSetId && endDate ? { kind, adSetId, endDate } : null
      case "targeting":
        return adSetId ? { kind, adSetId, fix, ...(fix === "ages" ? ages : {}) } : null
      default:
        return null
    }
  }
  const reset = () => {
    setPreview(null)
    setResult(null)
  }
  const check = () => {
    const c = change()
    if (!c) return
    start(async () => {
      setResult(null)
      setPreview(await previewPlatformEdit(p.slug, p.platform, p.campaign.id, c))
    })
  }
  const send = () => {
    const c = change()
    if (!c) return
    start(async () => setResult(await applyPlatformEdit(p.slug, p.platform, p.campaign.id, c)))
  }
  const adSets = p.campaign.adSets ?? []
  const needsAdSet = kind === "pause_ad_set" || kind === "ad_set_end" || kind === "targeting" || (kind === "budget" && p.platform === "meta" && adSets.length > 0)

  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-4 p-6 sm:max-w-lg">
        <div className="space-y-1 pr-8">
          <p className="text-xs text-muted-foreground">{platformName}</p>
          <DialogTitle className="truncate font-sans text-lg font-semibold" title={p.campaign.name}>
            {p.campaign.name}
          </DialogTitle>
        </div>
        <Field label="Change" id="pe-kind">
          <select
            id="pe-kind"
            className={fieldClass}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PlatformChange["kind"])
              reset()
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {needsAdSet && (
          <Field label="Ad set" id="pe-adset">
            <select id="pe-adset" className={fieldClass} value={adSetId} onChange={(e) => (setAdSetId(e.target.value), reset())}>
              {kind === "budget" && <option value="">The campaign&apos;s own budget</option>}
              {adSets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.status ? ` (${a.status.toLowerCase()})` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === "budget" && (
          <Field label="New daily budget" id="pe-budget">
            <Input id="pe-budget" type="number" min={1} step="1" value={budget} onChange={(e) => (setBudget(e.target.value), reset())} />
          </Field>
        )}
        {kind === "rename" && (
          <Field label="New name" id="pe-name">
            <Input id="pe-name" value={name} onChange={(e) => (setName(e.target.value), reset())} />
          </Field>
        )}
        {kind === "ad_set_end" && (
          <Field label="End date" id="pe-end">
            <Input id="pe-end" type="date" value={endDate} onChange={(e) => (setEndDate(e.target.value), reset())} />
          </Field>
        )}
        {kind === "targeting" && (
          <div className="space-y-3">
            <Field label="Fix" id="pe-fix">
              <select id="pe-fix" className={fieldClass} value={fix} onChange={(e) => (setFix(e.target.value as typeof fix), reset())}>
                <option value="audience_network_off">Turn the Audience Network off</option>
                <option value="advantage_off">Turn Advantage+ audience off</option>
                <option value="ages">Change the age range</option>
              </select>
            </Field>
            {fix === "ages" && (
              <div className="grid grid-cols-2 gap-3">
                <Input aria-label="Youngest" type="number" min={18} max={65} value={ages.ageMin} onChange={(e) => (setAges({ ...ages, ageMin: Number(e.target.value) }), reset())} />
                <Input aria-label="Oldest" type="number" min={18} max={65} value={ages.ageMax} onChange={(e) => (setAges({ ...ages, ageMax: Number(e.target.value) }), reset())} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">The ad set&apos;s whole targeting is read from Meta first; only this one thing changes.</p>
          </div>
        )}

        {(preview || result) && (
          <div className="space-y-1 rounded-md border p-3 text-[13px]">
            {(result ?? preview)!.lines.map((l) => (
              <p key={l} className="text-foreground">
                {l}
              </p>
            ))}
            {(result ?? preview)!.error && <p className="text-rag-red">{(result ?? preview)!.error}</p>}
            {result?.ok && <p className="text-rag-green">{result.live ? `Changed in ${platformName}.` : "Dry run: logged, nothing was sent."}</p>}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className={cn("pill", p.editLive ? "text-rag-green" : "text-rag-amber")}>{p.editLive ? "Live" : "Dry run"}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={p.onClose}>
              {result ? "Close" : "Cancel"}
            </Button>
            {!preview?.ok || result ? (
              <Button size="sm" onClick={check} disabled={pending || !change() || Boolean(result)}>
                {pending ? "Reading…" : "Check"}
              </Button>
            ) : (
              <Button size="sm" onClick={send} disabled={pending}>
                {pending ? "Sending…" : p.editLive ? `Change in ${platformName}` : "Log a dry run"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
