"use client"

import { ShieldCheck, Sparkles, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { fmt } from "@/lib/metrics/performance"
import { MATCHING_NOTES } from "@/lib/insights/search-matching"
import type { RootNegative, TermReview } from "@/lib/insights/term-review-rules"
import { cn } from "@/lib/utils"

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} minutes ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

const matchShown = (r: Pick<RootNegative, "text" | "matchType">) => (r.matchType === "EXACT" ? `[${r.text}]` : r.matchType === "PHRASE" ? `"${r.text}"` : r.text)

/**
 * "Check against the ICP" above the search terms (Dean, 2026-09-30): Claude's read of which searches
 * don't fit the client, and shorter negatives that block a whole theme. The chips on the table come
 * from the same review. Suggestions only; pushing goes through the usual (dry-run-gated) push.
 */
export function TermIcpPanel({ slug, campaignId, review, onReview, canCheck, canPush, currency, aiMax, onPushRoots }: { slug: string; campaignId: string; review: TermReview | null; onReview: (r: TermReview) => void; canCheck: boolean; canPush: boolean; currency: string; aiMax: { terms: number; spend: number; share: number } | null; onPushRoots: (roots: RootNegative[]) => void }) {
  const [running, setRunning] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const excluded = review?.terms.filter((t) => t.verdict === "exclude").length ?? 0
  const watched = review?.terms.filter((t) => t.verdict === "watch").length ?? 0

  const run = async () => {
    setRunning(true)
    try {
      const res = await fetch("/api/term-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, campaignId }) })
      const body = (await res.json().catch(() => ({}))) as { review?: TermReview; error?: string }
      if (!res.ok || !body.review) return void toast.error(body.error ?? "Couldn't check the terms.")
      onReview(body.review)
      setPicked(new Set())
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-3 border-b px-4 py-3">
      {aiMax && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <span className="mt-px rounded-full border border-violet-400/40 px-1.5 py-px text-[10px] text-violet-300">AI Max</span>
          <span>
            AI Max is on here: it found {aiMax.terms.toLocaleString("en-GB")} of these searches, {fmt("spend", aiMax.spend, currency)} ({Math.round(aiMax.share * 100)}% of the spend on visible terms). They didn&apos;t come from our keywords, so check them most often.
          </span>
        </p>
      )}

      {!review ? (
        canCheck && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">Check which searches don&apos;t fit the client&apos;s ICP. Claude reads the client brief and the top 300 terms (about a minute).</span>
            <Button size="sm" variant="outline" onClick={run} disabled={running} className="ml-auto gap-1.5">
              <Sparkles className="size-3.5" aria-hidden />
              {running ? "Checking…" : "Check against the ICP"}
            </Button>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm">{review.headline}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {review.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col items-end gap-1 text-[11px] text-muted-foreground">
              <span>
                {excluded} off-ICP · {watched} to watch · checked {ago(review.createdAt)}, top {review.termsSent} terms
              </span>
              {canCheck && (
                <button type="button" onClick={run} disabled={running} className="hover:text-foreground disabled:opacity-50">
                  {running ? "Checking…" : "Check again"}
                </button>
              )}
            </div>
          </div>

          {review.roots.length > 0 && (
            <div className="rounded-lg border">
              <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">Shorter negatives that block a whole off-ICP theme (whole campaign)</p>
              <ul className="divide-y">
                {review.roots.map((r) => (
                  <li key={r.text} className={cn("flex items-center gap-3 px-3 py-1.5 text-sm", r.unsafe && "opacity-70")}>
                    {canPush && (
                      <input
                        type="checkbox"
                        className="size-3.5 accent-lime"
                        disabled={Boolean(r.unsafe)}
                        checked={picked.has(r.text)}
                        aria-label={`Pick ${r.text}`}
                        onChange={() =>
                          setPicked((s) => {
                            const n = new Set(s)
                            if (n.has(r.text)) n.delete(r.text)
                            else n.add(r.text)
                            return n
                          })
                        }
                      />
                    )}
                    <span className="font-medium">{matchShown(r)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={r.reason}>
                      {r.reason}
                    </span>
                    {r.unsafe ? (
                      <span className="flex items-center gap-1 text-[11px] text-rag-amber" title={r.unsafe}>
                        <TriangleAlert className="size-3" aria-hidden /> {r.unsafe}
                      </span>
                    ) : (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        blocks {r.blocked} term{r.blocked === 1 ? "" : "s"}, {fmt("spend", r.blockedSpend, currency)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {canPush && picked.size > 0 && (
                <div className="flex justify-end border-t px-3 py-1.5">
                  <Button size="sm" onClick={() => onPushRoots(review.roots.filter((r) => picked.has(r.text)))}>
                    Add {picked.size} as negatives
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <details className="group text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">How search terms match (AI Max, close variants, negatives)</summary>
        <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {MATCHING_NOTES.map((n) => (
            <div key={n.title}>
              <dt className="font-medium text-foreground">{n.title}</dt>
              <dd className="leading-relaxed">{n.body}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  )
}
