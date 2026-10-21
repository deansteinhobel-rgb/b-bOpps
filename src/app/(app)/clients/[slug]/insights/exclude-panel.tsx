"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { LoaderCircleIcon } from "lucide-react"
import { fieldClass } from "@/components/field-class"
import { FACET_WORDS, type ExcludeFacet } from "@/lib/ads-api/exclusions"
import type { Platform } from "@/lib/metrics/types"
import { PLATFORM_NAME } from "@/lib/platform-links"
import { cn } from "@/lib/utils"
import { ActionDialog } from "./action-dialog"
import { planLinkedInExclusion, sendLinkedInExclusion, type ExclusionPlan } from "./exclude-actions"
import { pauseFromInsight, planPauseFromInsight, type PausePlan } from "./pause-actions"

/**
 * "Exclude … in LinkedIn" on a recommendation (Dean, 2026-10-21), in a pop-up: first what would
 * change on each campaign (read from LinkedIn, nothing sent), companies matched to their LinkedIn
 * page, then one click to send and a done or failed state. Live only when the edit switches are on.
 */
export function ExcludeDialog({ slug, insightKey, facet, items, open, onOpenChange }: { slug: string; insightKey: string; facet: ExcludeFacet; items: string[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const [plan, setPlan] = useState<ExclusionPlan | null>(null)
  const [urns, setUrns] = useState<Record<string, string>>({})

  // Asked once per opening; dev's double effect must not send a second read or drop the first answer.
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      asked.current = null
      return
    }
    const ask = `${insightKey}|${items.join(",")}`
    if (asked.current === ask) return
    asked.current = ask
    setPlan(null)
    planLinkedInExclusion(slug, insightKey, items)
      .then((p) => {
        setPlan(p)
        if (p.ok) setUrns(Object.fromEntries(p.values.flatMap((v) => (v.urn ? [[v.label, v.urn]] : []))))
      })
      .catch(() => setPlan({ ok: false, error: "Couldn't read the campaigns. Try again." }))
  }, [open, slug, insightKey, items])

  const ready = plan?.ok ? plan : null
  const companies = facet === "employers"
  const words = FACET_WORDS[facet]
  const unpicked = ready && companies && ready.connected ? ready.values.filter((v) => !urns[v.label]).length : 0
  const sendable = ready ? ready.campaigns.filter((c) => !c.error) : []

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      platform="linkedin"
      title={`Exclude ${items.length === 1 ? words.one : words.many}`}
      live={ready ? ready.live : null}
      reason={ready?.reason}
      confirmLabel={`Exclude on ${sendable.length} campaign${sendable.length === 1 ? "" : "s"}`}
      canConfirm={Boolean(ready) && sendable.length > 0 && !(ready && unpicked === ready.values.length && companies)}
      onDone={() => router.refresh()}
      onConfirm={async () => {
        const r = await sendLinkedInExclusion(slug, insightKey, { items, urns: companies ? urns : {} })
        return { ok: r.ok, live: r.live, message: r.message, details: r.campaigns.map((c) => ({ name: c.name, ok: c.ok, lines: c.lines, error: c.error })) }
      }}
    >
      {!plan ? (
        <Reading what={`${items.length} ${items.length === 1 ? words.one : words.many} and the campaigns they're on`} />
      ) : !plan.ok ? (
        <p className="text-rag-red">{plan.error}</p>
      ) : (
        <>
          {companies && plan.connected && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">The LinkedIn company for each name. Check the ones that aren&apos;t an exact match.</p>
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                {plan.values.map((v) => (
                  <li key={v.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>{v.label}</span>
                    {v.candidates.length ? (
                      <select
                        className={cn(fieldClass, "h-8 w-auto max-w-64 text-sm", !urns[v.label] && "border-rag-amber/60")}
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
              {unpicked > 0 && <p className="text-xs text-rag-amber">{unpicked} without a LinkedIn company will be left out.</p>}
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Only the {words.many} exclusions change; the rest of the targeting stays as it is.</p>
            <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
              {plan.campaigns.map((c) => (
                <li key={c.id} className="space-y-0.5 px-3 py-2">
                  <p className="truncate font-medium">{c.name}</p>
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
          </div>
        </>
      )}
    </ActionDialog>
  )
}

/** The loading state: what's being read, and rows standing in for the campaigns. */
export function Reading({ what, from = "LinkedIn" }: { what: string; from?: string }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Reading {what} from {from}…
      </p>
      <div className="divide-y rounded-lg border" aria-hidden>
        {[0, 1].map((n) => (
          <div key={n} className="space-y-2 px-3 py-3">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** "Pause in <platform>" on a cost per result or no-results recommendation, in the same pop-up. */
export function PauseDialog({ slug, insightKey, campaignName, platform = "linkedin", open, onOpenChange }: { slug: string; insightKey: string; campaignName: string | null; platform?: Platform; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const [plan, setPlan] = useState<PausePlan | null>(null)
  const asked = useRef(false)
  useEffect(() => {
    if (!open) {
      asked.current = false
      return
    }
    if (asked.current) return
    asked.current = true
    setPlan(null)
    planPauseFromInsight(slug, insightKey)
      .then(setPlan)
      .catch(() => setPlan({ ok: false, error: "Couldn't read the campaign. Try again." }))
  }, [open, slug, insightKey])

  const ready = plan?.ok ? plan : null
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      platform={platform}
      title="Pause the campaign"
      live={ready ? ready.live : null}
      reason={ready?.reason}
      confirmLabel={`Pause in ${PLATFORM_NAME[platform]}`}
      canConfirm={Boolean(ready)}
      onDone={() => router.refresh()}
      onConfirm={async () => {
        const r = await pauseFromInsight(slug, insightKey)
        return { ok: r.ok, live: r.live, message: r.message, details: [{ name: ready?.name ?? campaignName ?? "The campaign", ok: r.ok, lines: r.lines }] }
      }}
    >
      {!plan ? (
        <Reading what="the campaign" from={platform === "linkedin" ? "LinkedIn" : "Windsor"} />
      ) : !plan.ok ? (
        <p className="text-rag-red">{plan.error}</p>
      ) : (
        <div className="space-y-1 rounded-lg border px-3 py-2">
          <p className="truncate font-medium">{plan.name}</p>
          <p className="text-xs text-body">Status: {plan.status ?? "unknown"} → PAUSED</p>
          <p className="text-xs text-muted-foreground">It stops spending straight away. Turn it back on in {PLATFORM_NAME[platform]}; Lumaux never turns campaigns on.</p>
        </div>
      )}
    </ActionDialog>
  )
}
