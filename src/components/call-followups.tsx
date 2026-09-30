"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Phone, X } from "lucide-react"
import { ClientLogo } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { actOnFollowUp, planFollowUp } from "@/lib/calls/actions"
import type { FollowUp, Reminder } from "@/lib/calls/load"
import { KIND_LABEL } from "@/lib/calls/state"
import { cn } from "@/lib/utils"

export const shortDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
export const ago = (days: number) => (days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`)

const KIND_CLS: Record<FollowUp["kind"], string> = {
  try: "border-lime/40 text-lime",
  stop: "border-rag-red/40 text-rag-red",
  change: "border-lavender/40 text-lavender",
  idea: "border-violet/40 text-violet",
  follow_up: "border-foreground/20 text-muted-foreground",
}
export function KindChip({ kind }: { kind: FollowUp["kind"] }) {
  return <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium", KIND_CLS[kind])}>{KIND_LABEL[kind]}</span>
}

/**
 * What the team can do about something said on a call: done, plan it as a sprint test, remind me in
 * a week, or not doing it (with a reason). Everyone on the team sees the result.
 */
export function FollowUpActions({ item, compact, onDone }: { item: Pick<FollowUp, "id" | "kind" | "state">; compact?: boolean; onDone?: (msg?: string, url?: string) => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [dropping, setDropping] = useState(false)
  const [reason, setReason] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const run = (fn: () => Promise<{ ok: boolean; message?: string; url?: string }>) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) return setMsg(r.message ?? "Couldn't save.")
      setMsg(null)
      setDropping(false)
      onDone?.(r.message, r.url)
      router.refresh()
    })
  const closed = ["done", "dropped"].includes(item.state) || item.state === "snoozed"
  if (closed) {
    return (
      <button type="button" disabled={pending} onClick={() => run(() => actOnFollowUp(item.id, { action: "reopened" }))} className="text-[11px] text-muted-foreground underline hover:text-foreground">
        Reopen
      </button>
    )
  }
  if (dropping) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2">
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reason.trim() && run(() => actOnFollowUp(item.id, { action: "dropped", reason }))} placeholder="Why not? e.g. the client changed their mind on the 2 Oct call" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-xs outline-none focus:border-foreground/30" aria-label="Why we're not doing it" />
        <Button size="sm" variant="outline" disabled={pending || !reason.trim()} onClick={() => run(() => actOnFollowUp(item.id, { action: "dropped", reason }))}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDropping(false)}>
          Cancel
        </Button>
        {msg && <span className="text-xs text-rag-red">{msg}</span>}
      </div>
    )
  }
  const plannable = item.kind === "try" || item.kind === "idea" || item.kind === "change"
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact && "gap-1")}>
      <Button size="sm" disabled={pending} onClick={() => run(() => actOnFollowUp(item.id, { action: "done" }))}>
        It&apos;s done
      </Button>
      {plannable && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => planFollowUp(item.id))}>
          Plan as a sprint test
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => actOnFollowUp(item.id, { action: "snoozed", days: 7 }))}>
        Remind me next week
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDropping(true)}>
        Not doing it
      </Button>
      {msg && <span className="text-xs text-rag-red">{msg}</span>}
    </div>
  )
}

const HIDE_KEY = "lumaux.callReminders.hidden"
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())

/**
 * The pop-up (Dean, 2026-09-30): something said on a client call a week or more ago, with no sign of
 * it in the app or Notion. One at a time, bottom left (the news chat is bottom right). Closing it
 * hides it for today on this browser; the actions count for the whole team.
 */
export function CallReminders({ reminders, canEdit }: { reminders: Reminder[]; canEdit: boolean }) {
  const router = useRouter()
  const [hidden, setHidden] = useState(true)
  const [index, setIndex] = useState(0)
  const [note, setNote] = useState<{ text: string; url?: string } | null>(null)
  useEffect(() => {
    let off = false
    try {
      off = localStorage.getItem(HIDE_KEY) === today()
    } catch {}
    // Let the page settle first, so it arrives rather than flashes.
    const t = setTimeout(() => setHidden(off), 1200)
    return () => clearTimeout(t)
  }, [])
  if (hidden || (!reminders.length && !note)) return null
  const close = () => {
    try {
      localStorage.setItem(HIDE_KEY, today())
    } catch {}
    setHidden(true)
  }
  const r = reminders[Math.min(index, reminders.length - 1)]
  return (
    <aside role="status" aria-live="polite" className="animate-in fade-in slide-in-from-bottom-4 fixed bottom-4 left-4 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-lime/30 bg-elevated shadow-2xl shadow-black/60 lg:left-64">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Phone className="size-3.5 text-lime" aria-hidden />
        <p className="flex-1 text-xs font-medium">Said on a call, no sign of it yet</p>
        {reminders.length > 1 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <button type="button" onClick={() => setIndex((i) => (i - 1 + reminders.length) % reminders.length)} className="px-1 hover:text-foreground" aria-label="Previous">‹</button>
            {Math.min(index, reminders.length - 1) + 1} of {reminders.length}
            <button type="button" onClick={() => setIndex((i) => (i + 1) % reminders.length)} className="px-1 hover:text-foreground" aria-label="Next">›</button>
          </span>
        )}
        <button type="button" onClick={close} className="text-subtle-foreground hover:text-foreground" aria-label="Hide for today">
          <X className="size-4" />
        </button>
      </div>
      {note && !r ? (
        <div className="space-y-2 px-4 py-4 text-sm">
          <p>{note.text}</p>
          {note.url && <Link href={note.url} className="text-xs underline" onClick={() => setNote(null)}>Open it</Link>}
        </div>
      ) : (
        r && (
          <div className="space-y-3 px-4 py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ClientLogo name={r.client.name} logoUrl={r.client.logo_url} size="sm" />
              <span className="min-w-0 truncate">
                <span className="text-foreground">{r.client.name}</span> · {r.callTitle} · {shortDate(r.saidOn)}
              </span>
            </div>
            <div className="space-y-1.5">
              <p className="flex items-start gap-2 text-sm font-medium">
                <KindChip kind={r.kind} /> <span>{r.title}</span>
              </p>
              {r.quote && <p className="border-l-2 border-lime/40 pl-2.5 text-xs text-muted-foreground italic">&ldquo;{r.quote}&rdquo;</p>}
              <p className="text-xs text-muted-foreground">
                {ago(r.daysAgo)[0].toUpperCase() + ago(r.daysAgo).slice(1)}
                {r.ownerName ? ` (${r.ownerName})` : ""}, and nothing in Lumaux or Notion shows it&apos;s happened.
              </p>
            </div>
            {note && <p className="text-xs text-lime">{note.text} {note.url && <Link href={note.url} className="underline">Open it</Link>}</p>}
            {canEdit ? (
              <FollowUpActions item={r} compact onDone={(m, url) => { setNote(m ? { text: m, url } : null); setIndex(0); router.refresh() }} />
            ) : null}
            <Link href={`/clients/${r.client.slug}/brain#calls`} className="block text-[11px] text-muted-foreground underline hover:text-foreground">
              See the call notes
            </Link>
          </div>
        )
      )}
    </aside>
  )
}
