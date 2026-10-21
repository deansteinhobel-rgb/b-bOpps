"use client"

import { Check, Copy, ExternalLink, Share2 } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { fieldClass } from "@/components/field-class"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { encodeRange, PRESET_LABEL, PRESETS, QUICK_DAYS, rangeLabel, type RangeSpec } from "@/lib/metrics/range"
import type { EmbedLink } from "../embed-button"
import { createClientReportLink, turnOffReportLink } from "../embed-actions"

/**
 * "Share with the client" (Dean, 2026-10-19): a view-only link to this report (this platform and
 * campaign), opening on the dates picked here. The client can change the dates and nothing else.
 * The note is shown to the client under the summary; the label is for the team only.
 */
export function ShareReport({ slug, platform, campaign, title, range, links, canShare }: { slug: string; platform: string; campaign: string | null; title: string; range: RangeSpec; links: EmbedLink[]; canShare: boolean }) {
  const options = [
    ...QUICK_DAYS.map((d) => ({ value: String(d), label: `Last ${d} days` })),
    ...PRESETS.map((p) => ({ value: p, label: PRESET_LABEL[p] })),
    ...(range.kind === "custom" ? [{ value: encodeRange(range), label: `These dates (${rangeLabel(range)})` }] : []),
  ]
  const [opens, setOpens] = useState(encodeRange(range))
  const [note, setNote] = useState("")
  const [label, setLabel] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (!canShare && links.length === 0) return null

  const copy = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000)
      return true
    } catch {
      return false
    }
  }
  const create = () =>
    start(async () => {
      const r = await createClientReportLink(slug, { platform, campaign, opens, note: note || undefined, label: label || undefined })
      if (!r.ok || !r.url) return void toast.error(r.message ?? "Couldn't create the link.")
      setNote("")
      setLabel("")
      toast.success((await copy("new", r.url)) ? "Link created and copied. Send it to the client, or paste it into Notion with /embed." : "Link created. Copy it below.")
    })
  const turnOff = (l: EmbedLink) =>
    start(async () => {
      if (!window.confirm("Turn this link off? Anyone who has it will stop seeing the report. You can make a new link.")) return
      const r = await turnOffReportLink(slug, l.id)
      if (!r.ok) return void toast.error(r.message ?? "Couldn't turn the link off.")
      toast.success("Link turned off.")
    })

  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Share2 className="size-3.5" aria-hidden />
        Share with the client
        {links.length > 0 && <span className="rounded-full bg-black/15 px-1.5 text-[11px] tabular-nums">{links.length}</span>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{title}”</DialogTitle>
          <DialogDescription>A view-only link to this report. Whoever has it sees this report and can change its dates, and nothing else. Send it as it is, or paste it into a Notion page with /embed.</DialogDescription>
        </DialogHeader>

        {canShare && (
          <div className="space-y-3 rounded-lg border p-3">
            <label className="block space-y-1 text-xs text-muted-foreground">
              Opens on
              <select value={opens} onChange={(e) => setOpens(e.target.value)} className={`${fieldClass} h-8 text-foreground`}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
              Note for the client (optional, shown under the summary)
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="e.g. We paused the two weakest ads on 3 October and moved their budget to the webinar campaign." />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-40 flex-1 space-y-1 text-xs text-muted-foreground">
                Label (only the team sees it)
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. October update email" maxLength={120} className="h-8" />
              </label>
              <Button size="sm" disabled={pending} onClick={create}>
                {pending ? "Creating…" : "Create link"}
              </Button>
            </div>
          </div>
        )}

        {links.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {links.map((l) => (
              <li key={l.id} className="space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1 text-[11px]" title={l.url}>
                    {l.url}
                  </code>
                  <Button size="icon-sm" variant="outline" onClick={async () => !(await copy(l.id, l.url)) && toast.error("Couldn't copy the link.")} aria-label="Copy link">
                    {copied === l.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </Button>
                  <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-secondary" aria-label="Open the shared report in a new tab">
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
                <p className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {l.label ? `${l.label} · ` : ""}opens on {l.opens} · made {l.created} · {l.lastViewed ? `last viewed ${l.lastViewed}` : "not viewed yet"}
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
