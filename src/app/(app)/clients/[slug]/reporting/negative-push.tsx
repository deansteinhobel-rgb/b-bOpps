"use client"

import { Ban } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fieldClass } from "@/components/field-class"
import { cleanTerm, NEGATIVE_DEFAULTS, resultText, type MatchType, type NegativeLevel } from "@/lib/windsor/negatives"
import { cn } from "@/lib/utils"
import { pushNegatives } from "./negative-actions"

export type NegativeTerm = { text: string; adGroupId: string; groupName: string | null }

const MATCH_HELP: Record<MatchType, string> = {
  EXACT: "Blocks that exact search only. The safest.",
  PHRASE: "Blocks any search containing the phrase, in that order.",
  BROAD: "Blocks any search containing all of the words, in any order.",
}

/**
 * "Add as negatives" for ticked search terms (Dean, 2026-09-30). Pushes to Google Ads through
 * Windsor: the ad group each term came from, exact match, unless you pick otherwise. While live
 * pushes are off it only logs what it would send.
 */
export function NegativePush({ slug, campaignId, terms, live, open, onOpenChange, onDone }: { slug: string; campaignId: string; terms: NegativeTerm[]; live: boolean; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [level, setLevel] = useState<NegativeLevel>(NEGATIVE_DEFAULTS.level)
  const [matchType, setMatchType] = useState<MatchType>(NEGATIVE_DEFAULTS.matchType)
  const [pending, start] = useTransition()

  const groups = new Map<string, { name: string; terms: string[] }>()
  for (const t of terms) {
    const key = level === "ad_group" ? t.adGroupId : "campaign"
    const g = groups.get(key) ?? { name: level === "ad_group" ? (t.groupName ?? `Ad group ${t.adGroupId}`) : "Whole campaign", terms: [] }
    const text = cleanTerm(t.text)
    if (!g.terms.includes(text)) g.terms.push(text)
    groups.set(key, g)
  }
  const count = [...groups.values()].reduce((n, g) => n + g.terms.length, 0)

  const submit = () =>
    start(async () => {
      const r = await pushNegatives({ clientSlug: slug, campaignId, level, matchType, terms: terms.map((t) => ({ text: t.text, adGroupId: t.adGroupId })) })
      if (r.error) return void toast.error(r.error)
      const failed = r.pushes.filter((p) => p.status === "failed")
      const sent = r.pushes.filter((p) => p.status === "sent").reduce((n, p) => n + p.count, 0)
      const logged = r.pushes.filter((p) => p.status === "dry_run").reduce((n, p) => n + p.count, 0)
      if (failed.length) toast.error(`${failed.length} of ${r.pushes.length} pushes failed`, { description: failed.map((p) => p.error).join(" · ").slice(0, 300) })
      if (sent) toast.success(`Sent ${sent} negative${sent === 1 ? "" : "s"} to Google Ads`, { description: r.pushes.map((p) => resultText(p.result)).filter(Boolean).join(" · ").slice(0, 300) || "Google skips any that already exist." })
      if (logged) toast.success(`Logged ${logged} negative${logged === 1 ? "" : "s"} (test mode)`, { description: "Nothing was sent to Google Ads. Live pushes are still switched off." })
      if (!failed.length) {
        onDone()
        onOpenChange(false)
      }
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {count} negative keyword{count === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Ads will stop showing for these searches. They go to Google Ads through Windsor. To undo one, remove it in Google Ads: the app never removes negatives.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-xs text-muted-foreground">Add to</legend>
            <div className="flex gap-1 rounded-lg border p-1">
              {(
                [
                  ["ad_group", "The ad group it came from"],
                  ["campaign", "The whole campaign"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setLevel(v)} aria-pressed={level === v} className={cn("flex-1 rounded-md px-3 py-1.5 text-sm", level === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5 text-xs text-muted-foreground">
            Match type
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)} className={`${fieldClass} h-9 text-foreground`}>
              <option value="EXACT">Exact</option>
              <option value="PHRASE">Phrase</option>
              <option value="BROAD">Broad</option>
            </select>
            <span className="block">{MATCH_HELP[matchType]}</span>
          </label>

          <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
            {[...groups.entries()].map(([key, g]) => (
              <div key={key} className="px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {g.name} <span className="tabular-nums">· {g.terms.length}</span>
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {g.terms.map((t) => (
                    <li key={t} className="rounded-full border px-2 py-px text-xs">
                      {matchType === "EXACT" ? `[${t}]` : matchType === "PHRASE" ? `"${t}"` : t}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {!live && <p className="rounded-lg border border-rag-amber/30 bg-rag-amber/10 px-3 py-2 text-xs text-rag-amber">Test mode: this is logged and nothing is sent to Google Ads. Live pushes are switched on by Dean.</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || count === 0} className="gap-1.5">
            <Ban className="size-3.5" aria-hidden />
            {pending ? "Sending…" : live ? `Add ${count} in Google Ads` : `Log ${count} (test mode)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
