"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { fieldClass } from "@/components/field-class"
import { Button } from "@/components/ui/button"
import { FACET_WORDS } from "@/lib/ads-api/exclusions"
import { cn } from "@/lib/utils"
import { planLinkedInExclusion, sendLinkedInExclusion, type ExclusionPlan } from "./exclude-actions"

/**
 * "Exclude in LinkedIn" on a recommendation (Dean, 2026-10-21): first what would change on each
 * campaign (read from LinkedIn, nothing sent), companies matched to their LinkedIn page, then one
 * click to send. Live only when the edit switches are on; otherwise it's a logged dry run.
 */
export function ExcludePanel({ slug, insightKey, items, onClose }: { slug: string; insightKey: string; items: string[]; onClose: () => void }) {
  const [plan, setPlan] = useState<ExclusionPlan | null>(null)
  const [urns, setUrns] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()

  // Asked once per opening (the panel remounts for a new selection); dev's double effect must not
  // send a second read or drop the first answer.
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    planLinkedInExclusion(slug, insightKey, items)
      .then((p) => {
        setPlan(p)
        if (p.ok) setUrns(Object.fromEntries(p.values.flatMap((v) => (v.urn ? [[v.label, v.urn]] : []))))
      })
      .catch(() => setPlan({ ok: false, error: "Couldn't read the campaigns. Try again." }))
  }, [slug, insightKey, items])

  if (!plan) return <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">Reading the campaigns from LinkedIn…</p>
  if (!plan.ok)
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
        <span className="text-rag-red">{plan.error}</span>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    )

  const words = FACET_WORDS[plan.facet]
  const companies = plan.facet === "employers"
  const unpicked = companies && plan.connected ? plan.values.filter((v) => !urns[v.label]).length : 0
  const sendable = plan.campaigns.filter((c) => !c.error)
  const small = sendable.filter((c) => c.audience !== null && c.audience < 300)

  const send = () =>
    start(async () => {
      const r = await sendLinkedInExclusion(slug, insightKey, { items, urns: companies ? urns : {} })
      for (const c of r.campaigns.filter((c) => !c.ok)) toast.error(`${c.name}: ${c.error ?? "not changed"}`)
      if (r.ok || r.campaigns.some((c) => c.ok)) toast.success(r.message)
      else if (!r.campaigns.length) toast.error(r.message)
      if (r.ok) onClose()
    })

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">Exclude in LinkedIn</p>
        <span className={cn("pill", plan.live ? "border-lime/50 text-lime" : "text-muted-foreground")}>{plan.live ? "Live" : "Dry run"}</span>
      </div>
      {!plan.live && plan.reason && <p className="text-xs text-muted-foreground">{plan.reason}</p>}

      {companies && plan.connected && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">The LinkedIn company for each name. Check the ones that aren&apos;t an exact match.</p>
          <ul className="divide-y rounded-lg border">
            {plan.values.map((v) => (
              <li key={v.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>{v.label}</span>
                {v.candidates.length ? (
                  <select
                    className={cn(fieldClass, "h-8 w-auto max-w-72 text-sm", !urns[v.label] && "border-rag-amber/60")}
                    value={urns[v.label] ?? ""}
                    aria-label={`LinkedIn company for ${v.label}`}
                    onChange={(e) => setUrns((u) => ({ ...u, [v.label]: e.target.value }))}
                  >
                    <option value="">Pick the company…</option>
                    {v.candidates.map((c) => (
                      <option key={c.urn} value={c.urn}>
                        {c.name} ({c.urn.split(":").pop()})
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-rag-amber">Not found on LinkedIn: left out</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {plan.campaigns.length === 1 ? "The campaign" : `${plan.campaigns.length} campaigns`}. Only the {words.many} exclusions change; the rest of the targeting stays as it is.
        </p>
        <ul className="divide-y rounded-lg border">
          {plan.campaigns.map((c) => (
            <li key={c.id} className="space-y-0.5 px-3 py-2">
              <p className="font-medium">{c.name}</p>
              {c.lines.map((l) => (
                <p key={l} className="text-xs text-body">
                  {l}
                </p>
              ))}
              {c.audience !== null && (
                <p className={cn("text-xs tabular-nums", c.audience < 300 ? "text-rag-red" : "text-muted-foreground")}>Audience after: {c.audience.toLocaleString("en-US")} members</p>
              )}
              {c.error && <p className="text-xs text-rag-amber">{c.error}</p>}
            </li>
          ))}
        </ul>
        {small.length > 0 && <p className="text-xs text-rag-red">Campaigns under 300 members won&apos;t be changed.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || !sendable.length || unpicked === plan.values.length} onClick={send}>
          {pending ? "Sending…" : plan.live ? `Exclude on ${sendable.length} campaign${sendable.length === 1 ? "" : "s"}` : "Log a dry run"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        {unpicked > 0 && <span className="text-xs text-rag-amber">{unpicked} without a LinkedIn company will be left out.</span>}
      </div>
    </div>
  )
}
