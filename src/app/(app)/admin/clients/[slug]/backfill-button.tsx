"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { backfillChunk, creativesChunk } from "../../actions"

const DAYS = 90
const WINDOW = 30 // days per request, to stay under Vercel's time limit
// Previews: live ads all appear in recent data, so 14 days in 7-day windows is enough.
const PREVIEW_DAYS = 14
const PREVIEW_WINDOW = 7

const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 864e5))

/** Backfill 90 days, one account and one 30-day window at a time, with progress. */
export function BackfillButton({ accounts }: { accounts: { id: string; label: string }[] }) {
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const run = async () => {
    setRunning(true)
    setLog([])
    for (const a of accounts) {
      for (let end = 1; end < DAYS; end += WINDOW) {
        const from = daysAgo(Math.min(end + WINDOW - 1, DAYS))
        const to = daysAgo(end)
        setLog((l) => [...l, `${a.label}: ${from} to ${to}…`])
        const r = await backfillChunk(a.id, from, to).catch((e: Error) => ({ ok: false, rows: 0, error: e.message }))
        setLog((l) => [...l.slice(0, -1), `${a.label}: ${from} to ${to}: ${r.ok ? `${r.rows} rows` : `failed (${r.error})`}`])
      }
    }
    for (const a of accounts) {
      for (let end = 1; end < PREVIEW_DAYS; end += PREVIEW_WINDOW) {
        const from = daysAgo(Math.min(end + PREVIEW_WINDOW - 1, PREVIEW_DAYS))
        const to = daysAgo(end)
        setLog((l) => [...l, `${a.label}: ad previews ${from} to ${to}…`])
        const r = await creativesChunk(a.id, from, to).catch((e: Error) => ({ ok: false, ads: 0, copied: 0, error: e.message }))
        setLog((l) => [...l.slice(0, -1), `${a.label}: ad previews ${from} to ${to}: ${r.ok ? `${r.ads} ads, ${r.copied} new images` : `failed (${r.error})`}`])
      }
    }
    setLog((l) => [...l, "Done."])
    setRunning(false)
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={run} disabled={running || accounts.length === 0}>
        {running ? "Backfilling…" : "Backfill 90 days"}
      </Button>
      {log.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border bg-card p-2 font-mono text-xs" aria-live="polite">
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
