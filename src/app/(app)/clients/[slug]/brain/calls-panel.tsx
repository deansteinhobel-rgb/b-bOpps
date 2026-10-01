"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { ago, FollowUpActions, KindChip, shortDate } from "@/components/call-followups"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { addManualCall, linkCallNotes } from "@/lib/calls/actions"
import type { FollowUp } from "@/lib/calls/load"
import { STATE_LABEL, type CommitmentState } from "@/lib/calls/state"
import { cn } from "@/lib/utils"

export type Call = { id: string; source: "notion" | "manual"; notion_page_id: string | null; title: string; call_date: string; notion_status: string | null; summary: string | null; extract_status: "pending" | "done" | "failed" | "skipped"; extract_error: string | null; content_chars: number | null }
export type CallSource = { id: string; kind: "page" | "database"; clientOption: string | null; checkedAt: string | null } | null

const notionUrl = (id: string) => `https://www.notion.so/${id.replace(/-/g, "")}`
const STATE_CLS: Record<CommitmentState, string> = {
  due: "border-rag-amber/40 bg-rag-amber-bg text-rag-amber",
  open: "border-foreground/15 text-muted-foreground",
  acted: "border-rag-green/40 bg-rag-green-bg text-rag-green",
  done: "border-rag-green/40 text-rag-green",
  dropped: "border-foreground/15 text-subtle-foreground",
  snoozed: "border-foreground/15 text-subtle-foreground",
}
const minsAgo = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

type Tab = "attention" | "open" | "happened" | "closed"
const inTab: Record<Tab, CommitmentState[]> = { attention: ["due"], open: ["open", "due"], happened: ["acted"], closed: ["done", "dropped", "snoozed"] }

/**
 * Client calls (Dean, 2026-09-30): the client's call notes, read from Notion as they land (hourly,
 * read only), each summarized by Claude, and everything said on them that someone should act on. A
 * week after the call, anything with no sign of it in the app or Notion pops up for the team.
 */
export function CallsPanel(props: { slug: string; clientName: string; source: CallSource; sourceTitle: string | null; suggestions: { id: string; title: string; path: string | null }[]; calls: Call[]; followUps: FollowUp[]; canAdmin: boolean; canEdit: boolean; aiReady: boolean }) {
  const router = useRouter()
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const due = props.followUps.filter((f) => f.state === "due")
  const [tab, setTab] = useState<Tab>(due.length ? "attention" : "open")
  const [adding, setAdding] = useState(false)
  const shown = props.followUps.filter((f) => inTab[tab].includes(f.state))
  const reading = props.calls.filter((c) => c.extract_status === "pending").length

  const check = async (full = false) => {
    setError(null)
    try {
      let first = true
      for (;;) {
        setStatus("Reading the call notes from Notion…")
        const res = await fetch("/api/client-calls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientSlug: props.slug, full: full && first, first }) })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? "Something went wrong.")
        first = false
        router.refresh()
        if (!json.remaining) break
        setStatus(`Reading the call notes from Notion: ${json.remaining} to go…`)
      }
      setStatus(props.aiReady ? "Claude is reading the new calls. They appear here as each one is done." : null)
      setTimeout(() => { setStatus(null); router.refresh() }, 30_000)
    } catch (e) {
      setStatus(null)
      setError((e as Error).message)
    }
  }

  return (
    <section id="calls" className="scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-2xl">Client calls</h2>
          <p className="text-sm text-muted-foreground">
            {props.source ? (
              <>
                Read from{" "}
                <a href={notionUrl(props.source.id)} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  {props.sourceTitle ?? "Notion"}
                </a>
                {props.source.clientOption ? ` (rows with Client “${props.source.clientOption}”)` : ""} every hour, read only{props.source.checkedAt ? `, last checked ${minsAgo(props.source.checkedAt)}` : ""}. Claude summarizes each call for the brain and keeps track of what we said we&apos;d do. Anything with no sign of it a week later pops up for the team.
              </>
            ) : (
              `Link where ${props.clientName}'s call notes live in Notion. Claude reads every call (and the history), adds it to the brain, and reminds the team about anything said on a call that hasn't happened a week later.`
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)}>
              Add notes by hand
            </Button>
          )}
          {props.source && props.canEdit && (
            <Button size="sm" variant="outline" disabled={status !== null} onClick={() => check()}>
              {status ? "Checking…" : "Check for new calls"}
            </Button>
          )}
        </div>
      </div>
      {status && (
        <p className="flex items-center gap-2 text-sm text-lime" aria-live="polite">
          <span className="size-1.5 animate-pulse rounded-full bg-lime" /> {status}
        </p>
      )}
      {error && <p className="text-sm text-rag-red">{error}</p>}
      {!status && reading > 0 && <p className="text-xs text-muted-foreground">Claude is reading {reading} call{reading === 1 ? "" : "s"}. The hourly check carries on with the rest.</p>}

      {(!props.source || props.canAdmin) && <SourcePicker slug={props.slug} source={props.source} suggestions={props.suggestions} canAdmin={props.canAdmin} onLinked={() => check(true)} />}
      {adding && <ManualCall slug={props.slug} onDone={() => setAdding(false)} />}

      {(props.followUps.length > 0 || props.calls.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">Said on calls</h3>
                <p className="text-xs text-muted-foreground">Ideas to try, things to turn off, changes and follow-ups.</p>
              </div>
              <Segmented
                label="Show"
                tone="quiet"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "attention", label: "No sign yet", count: due.length },
                  { value: "open", label: "Open", count: props.followUps.filter((f) => inTab.open.includes(f.state)).length },
                  { value: "happened", label: "Seen happening", count: props.followUps.filter((f) => f.state === "acted").length },
                  { value: "closed", label: "Closed", count: props.followUps.filter((f) => inTab.closed.includes(f.state)).length },
                ]}
              />
            </div>
            <ul className="divide-y">
              {shown.map((f) => (
                <FollowUpRow key={f.id} f={f} slug={props.slug} canEdit={props.canEdit} />
              ))}
              {shown.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {tab === "attention" ? "Nothing waiting. Everything said on recent calls is either happening or less than a week old." : "Nothing here."}
                </li>
              )}
            </ul>
          </div>
          <CallList calls={props.calls} followUps={props.followUps} />
        </div>
      )}
    </section>
  )
}

function FollowUpRow({ f, slug, canEdit }: { f: FollowUp; slug: string; canEdit: boolean }) {
  const [open, setOpen] = useState(f.state === "due")
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 text-left">
        <KindChip kind={f.kind} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">{f.title}</span>
          <span className="block text-[11px] text-subtle-foreground">
            {f.callTitle} · {shortDate(f.saidOn)} · {ago(f.daysAgo)}
            {f.ownerSide === "client" ? " · the client to do" : f.ownerName ? ` · ${f.ownerName}` : ""}
            {f.dueOn ? ` · due ${shortDate(f.dueOn)}` : ""}
          </span>
        </span>
        <span className={cn("shrink-0 rounded-full border px-2 py-px text-[10px]", STATE_CLS[f.state])}>{STATE_LABEL[f.state]}</span>
        <ChevronDown className={cn("mt-0.5 size-3.5 shrink-0 text-subtle-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-1">
          {f.detail && <p className="text-xs text-muted-foreground">{f.detail}</p>}
          {f.quote && <p className="border-l-2 border-lime/40 pl-2.5 text-xs text-muted-foreground italic">&ldquo;{f.quote}&rdquo;</p>}
          {f.state === "acted" && f.evidence && (
            <p className="text-xs text-rag-green">
              {f.evidence}
              {f.evidenceHref && (
                <>
                  {" · "}
                  <a href={f.evidenceHref} target={f.evidenceHref.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="underline">
                    Open
                  </a>
                </>
              )}
            </p>
          )}
          {f.last && (
            <p className="text-[11px] text-subtle-foreground">
              {f.last.who ?? "Someone"}: {f.last.action === "dropped" ? `not doing it${f.last.reason ? `: ${f.last.reason}` : ""}` : f.last.action === "snoozed" ? `remind again ${f.last.snoozeUntil ? shortDate(f.last.snoozeUntil) : "later"}` : f.last.action === "planned" ? "planned as a sprint test" : f.last.action === "done" ? "marked done" : "reopened"} · {shortDate(f.last.at)}
              {f.last.testId && (
                <>
                  {" · "}
                  <Link href={`/clients/${slug}/sprint#test-${f.last.testId}`} className="underline">
                    See the test
                  </Link>
                </>
              )}
            </p>
          )}
          {canEdit && <FollowUpActions item={f} />}
        </div>
      )}
    </li>
  )
}

function CallList({ calls, followUps }: { calls: Call[]; followUps: FollowUp[] }) {
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const count = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of followUps) m.set(f.callId, (m.get(f.callId) ?? 0) + 1)
    return m
  }, [followUps])
  const list = showAll ? calls : calls.slice(0, 8)
  return (
    <div className="surface h-fit overflow-hidden">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Calls</h3>
        <p className="text-xs text-muted-foreground">{calls.length} read, newest first.</p>
      </div>
      <ul className="divide-y">
        {list.map((c) => (
          <li key={c.id} id={`call-${c.id}`} className="scroll-mt-24">
            <button type="button" onClick={() => setOpenId((o) => (o === c.id ? null : c.id))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent/40">
              <span className="w-12 shrink-0 text-[11px] text-muted-foreground tabular-nums">{shortDate(c.call_date)}</span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              {c.extract_status === "pending" ? (
                <span className="shrink-0 text-[10px] text-lime">Reading…</span>
              ) : c.extract_status === "failed" ? (
                <span className="shrink-0 text-[10px] text-rag-red" title={c.extract_error ?? undefined}>Couldn&apos;t read</span>
              ) : c.extract_status === "skipped" ? (
                <span className="shrink-0 text-[10px] text-subtle-foreground">{c.notion_status ?? "No notes"}</span>
              ) : (
                count.get(c.id) ? <span className="shrink-0 text-[10px] text-muted-foreground">{count.get(c.id)} said</span> : null
              )}
            </button>
            {openId === c.id && (
              <div className="space-y-2 px-4 pb-3 text-xs">
                {c.summary ? <p className="text-muted-foreground">{c.summary}</p> : <p className="text-subtle-foreground">{c.extract_status === "skipped" ? "Nothing to read yet (the call hasn't happened, or the notes are empty)." : "No summary yet."}</p>}
                <p className="flex gap-3 text-[11px] text-subtle-foreground">
                  {c.notion_status && <span>{c.notion_status}</span>}
                  {c.source === "manual" && <span>Added by hand</span>}
                  {c.notion_page_id && (
                    <a href={notionUrl(c.notion_page_id)} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                      Open in Notion
                    </a>
                  )}
                </p>
              </div>
            )}
          </li>
        ))}
        {calls.length === 0 && <li className="px-4 py-4 text-xs text-muted-foreground">No calls read yet.</li>}
      </ul>
      {calls.length > 8 && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="w-full border-t px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground">
          {showAll ? "Show fewer" : `Show all ${calls.length} calls`}
        </button>
      )}
    </div>
  )
}

function SourcePicker({ slug, source, suggestions, canAdmin, onLinked }: { slug: string; source: CallSource; suggestions: { id: string; title: string; path: string | null }[]; canAdmin: boolean; onLinked: () => void }) {
  const [editing, setEditing] = useState(!source)
  const [link, setLink] = useState("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // A shared database: which Client option is this client (when the name doesn't say).
  const [ask, setAsk] = useState<{ value: string; options: string[] } | null>(null)
  const [pending, start] = useTransition()
  if (!canAdmin) return <p className="surface px-4 py-4 text-sm text-muted-foreground">A GTM lead or admin links where this client&apos;s call notes live in Notion.</p>
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-muted-foreground underline hover:text-foreground">
        Change where the call notes live
      </button>
    )
  }
  const save = (value: string, option?: string) =>
    start(async () => {
      const r = await linkCallNotes(slug, value, option)
      setMsg({ ok: r.ok, text: r.message ?? (r.ok ? "Linked." : "Couldn't link it.") })
      setAsk(r.options ? { value, options: r.options } : null)
      if (r.ok) {
        setEditing(false)
        onLinked()
      }
    })
  return (
    <div className="surface space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold">Where do the call notes live?</h3>
        <p className="text-xs text-muted-foreground">Paste the Notion link to the database (one row per call) or the page (one sub-page per call). A database shared by several clients works too: Lumaux reads only this client&apos;s rows, by its Client property. Lumaux only ever reads it.</p>
      </div>
      <div className="flex gap-2">
        <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && link.trim() && save(link)} placeholder="https://www.notion.so/…" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30" aria-label="Notion link" />
        <Button size="sm" disabled={pending || !link.trim()} onClick={() => save(link)}>
          {pending ? "Checking…" : "Link"}
        </Button>
        {source && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-subtle-foreground">Found in the HQ:</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s.id} type="button" disabled={pending} onClick={() => save(s.id)} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-lime/40 hover:text-foreground" title={s.path ?? undefined}>
                {s.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <p className={cn("text-xs", msg.ok ? "text-lime" : ask ? "text-muted-foreground" : "text-rag-red")}>{msg.text}</p>}
      {ask && (
        <div className="flex flex-wrap gap-1.5">
          {ask.options.map((o) => (
            <button key={o} type="button" disabled={pending} onClick={() => save(ask.value, o)} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-lime/40 hover:text-foreground">
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ManualCall({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()))
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="surface space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold">Add call notes by hand</h3>
        <p className="text-xs text-muted-foreground">For a call whose notes aren&apos;t in Notion (a transcript, or notes from email). Claude reads them like any other call.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Call date" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly sync" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30" aria-label="Call name" />
      </div>
      <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the notes or transcript" className="text-sm" />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await addManualCall(slug, { date, title, text }); setMsg({ ok: r.ok, text: r.message ?? "" }); if (r.ok) { setText(""); setTitle(""); setTimeout(onDone, 2500) } })}>
          {pending ? "Saving…" : "Save and read"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {msg && <span className={cn("text-xs", msg.ok ? "text-lime" : "text-rag-red")}>{msg.text}</span>}
      </div>
    </div>
  )
}
