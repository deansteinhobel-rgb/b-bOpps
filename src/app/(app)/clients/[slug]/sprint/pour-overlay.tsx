"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { WinePour } from "@/components/fx/wine-pour"

const LINES = [
  "Letting your CTRs breathe…",
  "Notes of LinkedIn with a hint of Reddit…",
  "Checking what Google changed this week (again)…",
  "Swirling 12 weeks of cost per lead…",
  "Decanting your past sprints…",
  "Asking the sommelier about Performance Max…",
  "Pairing your budget with bolder tests…",
  "Crisp, dry, with a long finish of learnings…",
  "Reading the label on Meta's latest update…",
  "Chilling to the perfect hypothesis…",
]

/** The glass fills as Claude works; progress comes from the run row. */
export function PourOverlay({ runId, onDone }: { runId: string; onDone: (ok: boolean, message?: string) => void }) {
  const [state, setState] = useState({ progress: 0.03, note: "Uncorking…", served: false })
  const [line, setLine] = useState(0)
  const [hidden, setHidden] = useState(false)
  const done = useRef(false)
  const finish = useCallback((ok: boolean, message?: string) => {
    if (done.current) return
    done.current = true
    onDone(ok, message)
  }, [onDone])

  useEffect(() => {
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 3800)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    let stop = false
    const tick = async () => {
      const res = await fetch(`/api/sprint-ai?run=${runId}`, { cache: "no-store" }).catch(() => null)
      const d = (await res?.json().catch(() => null)) as { status: string; progress: number; stage_note: string | null; error: string | null } | null
      if (stop || !d) return
      if (d.status === "ready") {
        setState({ progress: 1, note: "Your sprint is served.", served: true })
        setTimeout(() => finish(true), 1600)
        return
      }
      if (d.status === "failed") return finish(false, d.error ?? undefined)
      setState((s) => ({ ...s, progress: Math.max(s.progress, d.progress), note: d.stage_note ?? s.note }))
      setTimeout(tick, 1500)
    }
    void tick()
    return () => {
      stop = true
    }
  }, [runId, finish])

  if (hidden) {
    return (
      <button type="button" onClick={() => setHidden(false)} className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-lg">
        <WinePour progress={state.progress} className="h-6 w-5" /> Pouring… {Math.round(state.progress * 100)}%
      </button>
    )
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Creating your sprint">
      <div className="pour-in flex max-w-md flex-col items-center gap-5 text-center">
        <WinePour progress={state.progress} pouring={!state.served} className="h-72 w-60 text-foreground" />
        <div className="space-y-2">
          <p className="font-heading text-3xl leading-tight">{state.served ? "Your sprint is served." : "Go pour yourself a Sauvignon Blanc while I create your sprint."}</p>
          {!state.served && (
            <p key={line} className="pour-in text-sm text-lime" aria-live="polite">
              {LINES[line]}
            </p>
          )}
          <p className="line-clamp-2 min-h-[2lh] text-xs text-muted-foreground">{state.note}</p>
        </div>
        <div className="h-1 w-56 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-lime transition-[width] duration-700" style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
        {!state.served && (
          <button type="button" onClick={() => setHidden(true)} className="text-xs text-muted-foreground underline hover:text-foreground">
            Keep working. It&apos;ll keep pouring in the background.
          </button>
        )}
      </div>
    </div>
  )
}
