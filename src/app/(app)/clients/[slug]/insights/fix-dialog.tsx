"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { fieldClass } from "@/components/field-class"
import type { PlatformFix } from "@/lib/platform-links"
import { cn } from "@/lib/utils"
import { ActionDialog } from "./action-dialog"
import { Reading } from "./exclude-panel"
import { budgetFromInsight, keywordsFromInsight, metaFixFromInsight, planBudgetFromInsight, planKeywordsFromInsight, planMetaFixFromInsight, type FixPlan } from "./fix-actions"

/**
 * Changes in Google Ads and Meta from a recommendation (Dean, 2026-10-21), in the same pop-up as
 * LinkedIn's: what would change (read through Windsor, nothing sent), confirm, then a check mark or
 * a cross per ad group or ad set. Live only when the edit switches are on.
 */
export const FIX_LABEL: Record<PlatformFix, string> = {
  keywords: "Add as keywords in Google Ads",
  budget: "Raise the budget in Google Ads",
  audience_network_off: "Turn off the Audience Network in Meta",
  advantage_off: "Turn off Advantage+ audience in Meta",
}

export function FixDialog({ slug, insightKey, fix, items, open, onOpenChange }: { slug: string; insightKey: string; fix: PlatformFix; items: string[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const [plan, setPlan] = useState<FixPlan | null>(null)
  const [match, setMatch] = useState<"EXACT" | "PHRASE">("EXACT")
  const [budget, setBudget] = useState("")
  const platform = fix === "keywords" || fix === "budget" ? "google_ads" : "meta"

  // Asked once per opening (and again when the match type changes).
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      asked.current = null
      return
    }
    const ask = `${insightKey}|${items.join(",")}|${match}`
    if (asked.current === ask) return
    asked.current = ask
    setPlan(null)
    const read = fix === "keywords" ? planKeywordsFromInsight(slug, insightKey, items, match) : fix === "budget" ? planBudgetFromInsight(slug, insightKey) : planMetaFixFromInsight(slug, insightKey, items)
    read
      .then((p) => {
        setPlan(p)
        if (p.ok && p.suggested) setBudget(String(p.suggested))
      })
      .catch(() => setPlan({ ok: false, error: "Couldn't read the campaign. Try again." }))
  }, [open, slug, insightKey, fix, items, match])

  const ready = plan?.ok ? plan : null
  const doable = ready ? ready.rows.filter((r) => !r.error) : []
  const amount = Number(budget)
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      platform={platform}
      title={FIX_LABEL[fix].replace(/ in (Google Ads|Meta)$/, "")}
      live={ready ? ready.live : null}
      reason={ready?.reason}
      confirmLabel={FIX_LABEL[fix]}
      canConfirm={Boolean(ready) && doable.length > 0 && (fix !== "budget" || amount > 0)}
      onDone={() => router.refresh()}
      onConfirm={() => (fix === "keywords" ? keywordsFromInsight(slug, insightKey, items, match) : fix === "budget" ? budgetFromInsight(slug, insightKey, amount) : metaFixFromInsight(slug, insightKey, items))}
    >
      {fix === "keywords" && (
        <label className="flex items-center gap-2 text-[13px]">
          Match type
          <select className={cn(fieldClass, "h-8 w-auto text-sm")} value={match} onChange={(e) => setMatch(e.target.value as "EXACT" | "PHRASE")}>
            <option value="EXACT">Exact</option>
            <option value="PHRASE">Phrase</option>
          </select>
        </label>
      )}
      {!plan ? (
        <Reading what={platform === "meta" ? "the ad sets" : "the campaign"} from="Windsor" />
      ) : !plan.ok ? (
        <p className="text-rag-red">{plan.error}</p>
      ) : (
        <>
          {fix === "budget" && (
            <label className="block space-y-1 text-[13px]">
              New daily budget
              <input className={cn(fieldClass, "h-8 w-32 text-sm")} type="number" min={1} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} />
              <span className="block text-xs text-muted-foreground">
                Suggested: 20% more{plan.max ? `, within this month's budget (at most ${plan.max} a day)` : ""}. The budget guard checks it again before anything is sent.
              </span>
            </label>
          )}
          <ul className="divide-y rounded-lg border">
            {plan.rows.map((r) => (
              <li key={`${r.name}-${r.campaignId}`} className="space-y-0.5 px-3 py-2">
                <p className="truncate font-medium">{r.name}</p>
                {fix === "budget" && r.lines[0] ? <p className="text-xs text-body">{r.lines[0].replace(/→ .*$/, `→ ${budget || "?"}`)}</p> : r.lines.map((l) => <p key={l} className="text-xs text-body">{l}</p>)}
                {r.error && <p className="text-xs text-rag-red">{r.error}</p>}
              </li>
            ))}
          </ul>
          {fix === "keywords" && <p className="text-xs text-muted-foreground">Each term goes into the ad group it converted in, enabled. Remove keywords by hand in Google Ads.</p>}
          {platform === "meta" && <p className="text-xs text-muted-foreground">Lumaux reads each ad set&apos;s whole targeting first and changes only this setting.</p>}
        </>
      )}
    </ActionDialog>
  )
}
