"use client"

import { Check, Copy, ExternalLink, Share2 } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { BoardKey } from "./boards"
import { createReportLink, turnOffReportLink } from "./embed-actions"

export type EmbedLink = { id: string; board: string; days: number; label: string | null; url: string; created: string; lastViewed: string | null }
const PERIODS = [7, 14, 30, 90] as const

/**
 * "Embed in Notion" for one report board (Dean, 2026-09-29): a view-only link to paste into a Notion
 * embed block. The viewer can change the period; the link shows this board and nothing else. Admins,
 * GTM leads and the client's AMs make links and turn them off; everyone on the team can copy them.
 */
export function EmbedButton({ slug, board, boardLabel, days, links, canShare }: { slug: string; board: BoardKey; boardLabel: string; days: number; links: EmbedLink[]; canShare: boolean }) {
  const [period, setPeriod] = useState<number>((PERIODS as readonly number[]).includes(days) ? days : 30)
  const [label, setLabel] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (!canShare && links.length === 0) return null

  const copy = async (l: EmbedLink) => {
    try {
      await navigator.clipboard.writeText(l.url)
      setCopied(l.id)
      toast.success("Link copied. In Notion, type /embed and paste it.")
      setTimeout(() => setCopied((c) => (c === l.id ? null : c)), 2000)
    } catch {
      toast.error("Couldn't copy the link.")
    }
  }
  const create = () =>
    start(async () => {
      const r = await createReportLink(slug, { board, days: period as 7 | 14 | 30 | 90, label: label || undefined })
      if (!r.ok) return void toast.error(r.message ?? "Couldn't create the link.")
      setLabel("")
      toast.success("Link created. Copy it below.")
    })
  const turnOff = (l: EmbedLink) =>
    start(async () => {
      if (!window.confirm("Turn this link off? Anywhere it's embedded will stop showing the report. This can't be undone, but you can make a new link.")) return
      const r = await turnOffReportLink(slug, l.id)
      if (!r.ok) return void toast.error(r.message ?? "Couldn't turn the link off.")
      toast.success("Link turned off.")
    })

  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1.5" />}>
        <Share2 className="size-3.5" aria-hidden />
        Embed in Notion
        {links.length > 0 && <span className="rounded-full bg-secondary px-1.5 text-[11px] tabular-nums text-muted-foreground">{links.length}</span>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Embed “{boardLabel}” in Notion</DialogTitle>
          <DialogDescription>
            A view-only link to this board. Anyone with it can see the board and change its period, and nothing else in the app. In Notion, type <span className="font-medium text-foreground">/embed</span> and paste the link.
          </DialogDescription>
        </DialogHeader>

        {canShare && (
          <div className="space-y-3 rounded-lg border bg-background/50 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Opens on</p>
                <div role="radiogroup" aria-label="Default period" className="inline-flex rounded-lg border bg-card p-0.5 text-xs">
                  {PERIODS.map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={period === d} onClick={() => setPeriod(d)} className={cn("rounded-md px-2.5 py-1 transition-colors", period === d ? "bg-lime font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
              <label className="min-w-40 flex-1 space-y-1 text-xs text-muted-foreground">
                Note (optional)
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Monthly report page" maxLength={120} className="h-8" />
              </label>
              <Button size="sm" disabled={pending} onClick={create}>
                {pending ? "Creating…" : "Create link"}
              </Button>
            </div>
          </div>
        )}

        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No links for this board yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {links.map((l) => (
              <li key={l.id} className="space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1 text-[11px]" title={l.url}>
                    {l.url}
                  </code>
                  <Button size="icon-sm" variant="outline" onClick={() => copy(l)} aria-label="Copy link">
                    {copied === l.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </Button>
                  <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-secondary" aria-label="Open the embed in a new tab">
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
                <p className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {l.label ? `${l.label} · ` : ""}opens on {l.days} days · made {l.created} · {l.lastViewed ? `last viewed ${l.lastViewed}` : "not viewed yet"}
                  </span>
                  {canShare && (
                    <button type="button" disabled={pending} onClick={() => turnOff(l)} className="text-rag-red hover:underline disabled:opacity-50">
                      Turn off
                    </button>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
