"use client"

import { useState, useTransition } from "react"
import { fieldClass } from "@/components/admin-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import type { SprintChange, SprintItem } from "@/lib/sprints/data"
import type { Suggestion } from "@/lib/sprints/detect"
import { cn } from "@/lib/utils"
import { logChange, setChangeStatus } from "./actions"

export const CHANGE_TYPES: Record<string, string> = {
  budget: "Budget",
  creative: "Creative",
  targeting: "Targeting",
  bidding: "Bidding",
  landing_page: "Landing page",
  tracking: "Tracking",
  structure: "Campaign structure",
  other: "Other",
}
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso))

export function ChangeLog(props: {
  sprintId: string
  changes: SprintChange[]
  suggestions: Suggestion[]
  hypotheses: SprintItem[]
  platforms: Platform[]
  today: string
  readOnly: boolean
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ changed_on: props.today, platform: "", type: "budget", campaign_name: "", description: "", hypothesis_item_id: "" })
  const logged = props.changes.filter((c) => c.status === "logged")
  const hypothesisText = new Map(props.hypotheses.map((h) => [h.id, h.text]))

  const submit = () =>
    start(async () => {
      const r = await logChange(props.sprintId, {
        changed_on: form.changed_on,
        platform: (form.platform || null) as Platform | null,
        type: form.type as "budget",
        campaign_name: form.campaign_name || null,
        description: form.description,
        hypothesis_item_id: form.hypothesis_item_id || null,
      })
      if (r.ok) {
        setForm((f) => ({ ...f, campaign_name: "", description: "", hypothesis_item_id: "" }))
        setError(null)
      } else setError(r.message ?? "Couldn't save.")
    })

  const fromSuggestion = (s: Suggestion, status: "logged" | "dismissed") =>
    start(async () => {
      const r = await logChange(props.sprintId, {
        changed_on: s.changed_on,
        platform: s.platform,
        type: s.type,
        campaign_name: s.campaign_name,
        description: s.description,
        hypothesis_item_id: null,
        detected_key: s.key,
        status,
      })
      if (!r.ok) setError(r.message ?? "Couldn't save.")
    })

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        {!props.readOnly && (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <p className="text-sm font-bold">Log a change</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="c-date">Date</Label>
                <Input id="c-date" type="date" value={form.changed_on} onChange={(e) => setForm({ ...form, changed_on: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-platform">Platform</Label>
                <select id="c-platform" className={fieldClass} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                  <option value="">All / none</option>
                  {props.platforms.map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-type">Type</Label>
                <select id="c-type" className={fieldClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(CHANGE_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-campaign">Campaign (optional)</Label>
                <Input id="c-campaign" value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-desc">What changed</Label>
              <Input id="c-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Moved $2k/month from Brand to Competitor campaigns" />
            </div>
            {props.hypotheses.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="c-hyp">Tests hypothesis (optional)</Label>
                <select id="c-hyp" className={fieldClass} value={form.hypothesis_item_id} onChange={(e) => setForm({ ...form, hypothesis_item_id: e.target.value })}>
                  <option value="">None</option>
                  {props.hypotheses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.text.slice(0, 90)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button onClick={submit} disabled={pending || !form.description.trim()}>
                {pending ? "Saving…" : "Log change"}
              </Button>
              {error && <span className="text-sm text-rag-red">{error}</span>}
            </div>
          </div>
        )}

        {logged.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No changes logged yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l pl-5">
            {logged.map((c) => (
              <li key={c.id} className="relative text-sm">
                <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-card bg-ink" aria-hidden />
                <p className="text-xs text-muted-foreground">
                  {shortDate(c.changed_on)} · {CHANGE_TYPES[c.type] ?? c.type}
                  {c.platform && ` · ${PLATFORM_LABEL[c.platform]}`}
                  {c.source === "detected" && " · detected in Windsor"}
                  {c.profiles && ` · ${c.profiles.full_name ?? c.profiles.email}`}
                </p>
                <p>{c.description}</p>
                {c.campaign_name && c.source === "manual" && <p className="text-xs text-muted-foreground">Campaign: {c.campaign_name}</p>}
                {c.hypothesis_item_id && hypothesisText.get(c.hypothesis_item_id) && (
                  <p className="text-xs text-muted-foreground">Tests: {hypothesisText.get(c.hypothesis_item_id)}</p>
                )}
                {!props.readOnly && (
                  <button type="button" className="text-xs text-muted-foreground underline hover:text-rag-red" onClick={() => start(async () => void (await setChangeStatus(c.id, "dismissed")))}>
                    Remove from log
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <aside className="space-y-3">
        <p className="text-sm font-bold">Detected in Windsor</p>
        <p className="text-xs text-muted-foreground">Changes spotted in the ad data this sprint. Log the ones your team made, and dismiss the rest.</p>
        {props.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nothing new to review.</p>
        ) : (
          <ul className="space-y-2">
            {props.suggestions.slice(0, 12).map((s) => (
              <li key={s.key} className={cn("rounded-md border bg-card p-3 text-sm", pending && "opacity-70")}>
                <p className="text-xs text-muted-foreground">
                  {shortDate(s.changed_on)} · {CHANGE_TYPES[s.type]}
                </p>
                <p className="line-clamp-3" title={s.description}>
                  {s.description}
                </p>
                {!props.readOnly && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => fromSuggestion(s, "logged")}>
                      Log it
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => fromSuggestion(s, "dismissed")}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {props.suggestions.length > 12 && <p className="text-xs text-muted-foreground">+{props.suggestions.length - 12} older. Log or dismiss the ones above to see them.</p>}
      </aside>
    </div>
  )
}
