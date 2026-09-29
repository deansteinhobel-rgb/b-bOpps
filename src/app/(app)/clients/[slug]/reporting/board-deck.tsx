"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useState } from "react"
import { PlatformIcon } from "@/components/brand"
import { Segmented } from "@/components/segmented"
import type { Platform } from "@/lib/metrics/types"

/**
 * The report boards one at a time, like Databox's slides (Dean): tabs to jump, and ‹ 1 / 4 › to step
 * through. The boards are rendered on the server and passed in; this only picks which one shows.
 */
export function BoardDeck({ boards }: { boards: { key: string; label: string; platform: Platform | null; actions?: React.ReactNode; node: React.ReactNode }[] }) {
  const [i, setI] = useState(0)
  const step = (d: number) => setI((i + d + boards.length) % boards.length)
  if (boards.length === 0) return null
  const current = boards[Math.min(i, boards.length - 1)]

  return (
    <div
      className="space-y-3"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1)
        if (e.key === "ArrowLeft") step(-1)
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {boards.length > 1 ? (
          <Segmented
            label="Report"
            tone="quiet"
            value={current.key}
            onChange={(v) => setI(boards.findIndex((b) => b.key === v))}
            options={boards.map((b) => ({
              value: b.key,
              label: (
                <span className="flex items-center gap-1.5">
                  {b.platform && <PlatformIcon platform={b.platform} className="size-3.5" />}
                  {b.label}
                </span>
              ),
            }))}
          />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {current.actions}
          {boards.length > 1 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <button type="button" onClick={() => step(-1)} className="rounded-md border p-1 hover:bg-secondary hover:text-foreground" aria-label="Previous report">
                <ChevronLeft className="size-4" />
              </button>
              <span className="w-12 text-center tabular-nums" aria-live="polite">
                {i + 1} / {boards.length}
              </span>
              <button type="button" onClick={() => step(1)} className="rounded-md border p-1 hover:bg-secondary hover:text-foreground" aria-label="Next report">
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
      {current.node}
    </div>
  )
}
