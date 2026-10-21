"use client"

import { useState, type ReactNode } from "react"
import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react"
import { PlatformIcon } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Platform } from "@/lib/metrics/types"
import { PLATFORM_NAME } from "@/lib/platform-links"
import { cn } from "@/lib/utils"

/**
 * The pop-up for a change in an ad platform from Recommendations (Dean, 2026-10-21: "so the user is
 * aware this is an actual change"): review what will change, confirm, then a check mark when it's
 * done or a cross with the reason when it failed. Live or dry run is always shown.
 */
export type ActionOutcome = { ok: boolean; live: boolean; message: string; details?: { name: string; ok: boolean; lines?: string[]; error?: string }[] }
type Phase = "review" | "sending" | "result"

export function ActionDialog(p: {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: Platform
  title: string
  /** null while the review is still loading. */
  live: boolean | null
  reason?: string | null
  children: ReactNode
  confirmLabel: string
  canConfirm: boolean
  onConfirm: () => Promise<ActionOutcome>
  /** After a live success, e.g. refresh the page. */
  onDone?: () => void
}) {
  const [phase, setPhase] = useState<Phase>("review")
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null)
  const name = PLATFORM_NAME[p.platform]

  const confirm = async () => {
    setPhase("sending")
    try {
      setOutcome(await p.onConfirm())
    } catch {
      setOutcome({ ok: false, live: Boolean(p.live), message: "Something went wrong before Lumaux heard back. Check the platform: the change may or may not have gone through." })
    }
    setPhase("result")
  }
  const close = (open: boolean) => {
    if (phase === "sending") return // never close mid-send
    p.onOpenChange(open)
    if (!open) {
      if (outcome?.ok && outcome.live) p.onDone?.()
      setPhase("review")
      setOutcome(null)
    }
  }

  return (
    <Dialog open={p.open} onOpenChange={close}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <PlatformIcon platform={p.platform} className="size-5" />
            <span className="truncate">{p.title}</span>
            {p.live !== null && (
              <span className={cn("pill ml-auto shrink-0", p.live ? "border-white/30 text-foreground" : "text-muted-foreground")}>{p.live ? `Live in ${name}` : "Dry run"}</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {p.live === null
              ? `Lumaux reads the campaign from ${name} first. Nothing changes until you confirm.`
              : p.live
                ? `This changes the campaign in ${name}.`
                : (p.reason ?? `Nothing will be sent to ${name}; the change is only logged.`)}{" "}
            Every change is logged with the value before it, in Admin → Activity.
          </DialogDescription>
        </DialogHeader>

        {phase === "result" && outcome ? (
          <Result outcome={outcome} platform={name} />
        ) : (
          <div className={cn("space-y-4 text-sm", phase === "sending" && "pointer-events-none opacity-60")}>{p.children}</div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {phase === "result" ? (
            <Button size="sm" onClick={() => close(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={phase === "sending"} onClick={() => close(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={phase === "sending" || !p.canConfirm || p.live === null} onClick={confirm}>
                {phase === "sending" || p.live === null ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <PlatformIcon platform={p.platform} className="size-3.5" />}
                {phase === "sending" ? `Sending to ${name}…` : p.live === null ? "Checking…" : p.live ? p.confirmLabel : "Log a dry run"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Result({ outcome, platform }: { outcome: ActionOutcome; platform: string }) {
  const good = outcome.ok
  return (
    <div className="space-y-3 text-sm" role="status">
      <div className="flex items-center gap-3">
        {/* A plain colored mark, no tinted circle behind it. */}
        {good ? <CheckIcon className="size-5 shrink-0 text-rag-green" aria-hidden /> : <XIcon className="size-5 shrink-0 text-rag-red" aria-hidden />}
        <div>
          <p className="font-medium">{good ? (outcome.live ? `Done in ${platform}` : "Dry run logged") : outcome.live ? "It didn't go through" : "Couldn't log it"}</p>
          <p className="text-body">{outcome.message}</p>
        </div>
      </div>
      {outcome.details && outcome.details.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {outcome.details.map((d, n) => (
            <li key={n} className="flex items-start gap-2 px-3 py-2">
              {d.ok ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-rag-green" /> : <XIcon className="mt-0.5 size-4 shrink-0 text-rag-red" />}
              <span className="min-w-0">
                <span className="block truncate">{d.name}</span>
                {d.lines?.map((l) => (
                  <span key={l} className="block text-xs text-muted-foreground">
                    {l}
                  </span>
                ))}
                {d.error && <span className="block text-xs text-rag-red">{d.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
