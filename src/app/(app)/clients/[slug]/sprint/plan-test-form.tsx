"use client"

import { useState, useTransition } from "react"
import { fieldClass } from "@/components/admin-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { ASSETS, METRICS } from "@/lib/sprints/tests"
import { planTest } from "./test-actions"

export type Owner = { id: string | null; name: string; onTeam: boolean }

/** Plan a test in under a minute: platform, what, what to brief in, what success looks like, who, by when. */
export function PlanTestForm({ sprintId, platforms, owners, defaultDeadline }: { sprintId: string; platforms: Platform[]; owners: Owner[]; defaultDeadline: string }) {
  const empty = { platform: (platforms[0] ?? "") as string, title: "", hypothesis: "", assets: [] as string[], brief_notes: "", success_metric: "cost_per_result", success_target: "", success_text: "", owner: "", deadline: defaultDeadline }
  const [f, setF] = useState(empty)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="w-full sm:w-auto">
        + Plan a test
      </Button>
    )
  }
  const submit = () =>
    start(async () => {
      const r = await planTest(sprintId, {
        platform: (f.platform || null) as Platform | null,
        title: f.title,
        hypothesis: f.hypothesis,
        assets: f.assets,
        brief_notes: f.brief_notes,
        success_metric: f.success_target ? f.success_metric : null,
        success_target: f.success_target,
        success_text: f.success_text,
        owner_notion_user_id: f.owner || null,
        deadline: f.deadline || null,
      })
      if (r.ok) {
        setF(empty)
        setOpen(false)
        setError(null)
      } else setError(r.message ?? "Couldn't save.")
    })
  const toggleAsset = (a: string) => setF({ ...f, assets: f.assets.includes(a) ? f.assets.filter((x) => x !== a) : [...f.assets, a] })

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <p className="font-heading text-xl">Plan a test</p>
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-1">
          <Label htmlFor="t-platform">Platform</Label>
          <select id="t-platform" className={fieldClass} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
            <option value="">Several platforms</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="t-title">What we&apos;re testing</Label>
          <Input id="t-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Calculator lead magnet vs. demo CTA for SMB clinics" />
        </div>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-sm">What to brief in</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ASSETS).map(([k, v]) => (
            <label key={k} className="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm has-checked:border-ink has-checked:bg-ink has-checked:text-white">
              <input type="checkbox" className="sr-only" checked={f.assets.includes(k)} onChange={() => toggleAsset(k)} />
              {v}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="t-notes">Brief for the team (optional)</Label>
        <Textarea id="t-notes" rows={2} value={f.brief_notes} onChange={(e) => setF({ ...f, brief_notes: e.target.value })} placeholder="Audience, message, formats, references…" />
      </div>

      <div className="space-y-1">
        <p className="text-sm">What success looks like</p>
        <div className="grid gap-3 sm:grid-cols-[14rem_9rem_1fr]">
          <select aria-label="Success metric" className={fieldClass} value={f.success_metric} onChange={(e) => setF({ ...f, success_metric: e.target.value })}>
            {Object.entries(METRICS).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label} {m.lowerIsBetter ? "at or below" : "at or above"}
              </option>
            ))}
          </select>
          <Input aria-label="Target" type="number" min="0" step="0.01" value={f.success_target} onChange={(e) => setF({ ...f, success_target: e.target.value })} placeholder="Target" />
          <Input aria-label="Success in words" value={f.success_text} onChange={(e) => setF({ ...f, success_text: e.target.value })} placeholder="…and/or in words, e.g. 10+ demo requests" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="t-owner">Owner</Label>
          <select id="t-owner" className={fieldClass} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
            <option value="">Pick an owner</option>
            {owners.map((o) => (
              <option key={o.id ?? o.name} value={o.id ?? ""} disabled={!o.id}>
                {o.name}
                {!o.id ? " (no Notion user)" : o.onTeam ? "" : " (not on this client)"}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="t-deadline">Deadline for assets</Label>
          <Input id="t-deadline" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Add a hypothesis (optional)</summary>
        <Textarea className="mt-2" rows={2} value={f.hypothesis} onChange={(e) => setF({ ...f, hypothesis: e.target.value })} placeholder="If we…, then… because…" />
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={pending || !f.title.trim()}>
          {pending ? "Saving…" : "Save test"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {error && <span className="text-sm text-rag-red">{error}</span>}
      </div>
    </div>
  )
}
