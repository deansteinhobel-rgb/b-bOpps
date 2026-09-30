"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import { createClient as createSupabase } from "@supabase/supabase-js"
import { ChevronDown, FileText, X } from "lucide-react"
import { Sparkle } from "@/components/fx/sparkle"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { addNote, finishUpload, removeFile, removeNote, saveBriefEdit, setHqPageIncluded, startUpload } from "./actions"

export type Brief = { id: string; content: string | null; written_by: "claude" | "person"; source_count: number | null; created_at: string; finished_at: string | null; profiles: { full_name: string | null } | null }
export type Knowledge = {
  id: string
  source: "notion" | "note" | "file"
  notion_page_id: string | null
  notion_kind: "page" | "database" | null
  path: string | null
  include: boolean
  category: "target" | "constraint" | "note" | null
  file_type: string | null
  title: string
  content_chars: number | null
  synced_at: string | null
  error: string | null
  created_at: string
}

const NOTE_KINDS = [
  { key: "target", label: "Target", cls: "border-lime/40 text-lime" },
  { key: "constraint", label: "Rule", cls: "border-rag-red/40 text-rag-red" },
  { key: "note", label: "Note", cls: "border-foreground/20 text-muted-foreground" },
] as const
const kindOf = (k: string | null) => NOTE_KINDS.find((n) => n.key === k) ?? NOTE_KINDS[2]
const UNCHANGED = "Nothing changed since the last brief."
const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
const kchars = (n: number | null) => (!n ? "" : n < 1000 ? `${n} chars` : `${Math.round(n / 1000)}k chars`)

/**
 * The Client brain: the brief Claude writes from the client's Notion HQ, team must-knows and
 * files. "Pour me a sprint" reads the brief and must-knows every time.
 */
export function BrainView(props: { slug: string; clientName: string; hqPageId: string | null; canAdmin: boolean; aiReady: boolean; brief: Brief | null; generating: string | null; lastFailed: string | null; knowledge: Knowledge[] }) {
  const router = useRouter()
  const [status, setStatus] = useState<string | null>(props.generating ? "Writing the brief…" : null)
  const [error, setError] = useState<string | null>(props.lastFailed && props.lastFailed !== UNCHANGED ? props.lastFailed : null)
  const busy = status !== null
  const notion = props.knowledge.filter((k) => k.source === "notion")
  const notes = props.knowledge.filter((k) => k.source === "note")
  const files = props.knowledge.filter((k) => k.source === "file")
  const included = notion.filter((k) => k.include)

  const call = async (body: object) => {
    const res = await fetch("/api/client-brain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientSlug: props.slug, ...body }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? "Something went wrong.")
    return json
  }
  const pollBrief = async (id: string) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500))
      const d = (await fetch(`/api/client-brain?brief=${id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as { status: string; error: string | null } | null
      if (!d || d.status === "generating") continue
      if (d.status === "failed" && d.error !== UNCHANGED) throw new Error(d.error ?? "The brief failed.")
      return d.status === "ready" ? "Brief updated." : "Already up to date."
    }
  }
  /** Refresh: find HQ pages → read changed ones in batches → rebuild the brief. */
  const refresh = async (opts: { force?: boolean; notion?: boolean } = {}) => {
    setError(null)
    try {
      const since = opts.force ? new Date().toISOString() : undefined
      if (opts.notion !== false && props.hqPageId) {
        setStatus("Looking through the Notion HQ…")
        await call({ step: "discover", force: opts.force })
        let total: number | null = null
        let done = 0
        for (;;) {
          const r = (await call({ step: "read", since })) as { read: number; remaining: number }
          done += r.read
          total ??= r.read + r.remaining
          setStatus(`Reading HQ pages: ${done} of ${total}…`)
          if (r.remaining === 0 || r.read === 0) break
        }
      }
      setStatus("Writing the brief… about a minute")
      const { briefId } = (await call({ step: "brief", force: opts.force })) as { briefId: string }
      const msg = await pollBrief(briefId)
      setStatus(null)
      setError(null)
      router.refresh()
      if (msg === "Already up to date.") setError(null)
    } catch (e) {
      setStatus(null)
      setError((e as Error).message)
      router.refresh()
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-2xl">Client brain</h2>
          <p className="text-sm text-muted-foreground">
            Everything we know about {props.clientName}: the Notion HQ, the team&apos;s must-knows and uploaded files, condensed into one brief. Pour me a sprint reads it every time.
          </p>
        </div>
        {props.canAdmin && (
          <div className="flex flex-col items-end gap-1">
            <Sparkle>
              <Button onClick={() => refresh()} disabled={busy || !props.aiReady}>
                {busy ? "Refreshing…" : props.brief ? "Refresh and rebuild" : "Build the brain"}
              </Button>
            </Sparkle>
            <button type="button" onClick={() => refresh({ force: true })} disabled={busy} className="text-[11px] text-muted-foreground underline hover:text-foreground disabled:opacity-50">
              Re-read every page
            </button>
          </div>
        )}
      </div>
      {status && (
        <p className="flex items-center gap-2 text-sm text-lime" aria-live="polite">
          <span className="size-1.5 animate-pulse rounded-full bg-lime" /> {status}
        </p>
      )}
      {error && <p className="text-sm text-rag-red">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <BriefPanel slug={props.slug} brief={props.brief} sources={included.length + notes.length + files.length} canAdmin={props.canAdmin} />
        <div className="space-y-6">
          <MustKnows slug={props.slug} notes={notes} />
          <Files slug={props.slug} files={files} />
        </div>
      </div>

      <HqSources slug={props.slug} hqPageId={props.hqPageId} pages={notion} canAdmin={props.canAdmin} />
    </div>
  )
}

/** Source names in the brief ("[Messaging]") become small chips. */
const chipSources = (md: string) => md.replace(/\[([^\]\n]{2,80})\](?!\()/g, "`§$1`")

function BriefPanel({ slug, brief, sources, canAdmin }: { slug: string; brief: Brief | null; sources: number; canAdmin: boolean }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(brief?.content ?? "")
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (!brief?.content) {
    return (
      <section className="surface flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="font-heading text-xl">No brief yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {canAdmin ? "Tick the HQ pages that matter below, add any must-knows, then Build the brain." : "A GTM lead or admin can build it from the Notion HQ."}
        </p>
      </section>
    )
  }
  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {brief.written_by === "person" ? `Corrected by ${brief.profiles?.full_name ?? "the team"}` : `Written by Claude from ${brief.source_count ?? sources} sources`} · {date(brief.finished_at ?? brief.created_at)}
        </p>
        {!editing && (
          <button type="button" onClick={() => { setText(brief.content ?? ""); setEditing(true) }} className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            Correct the brief
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3 p-5">
          <p className="text-xs text-muted-foreground">Edit the markdown. Your version is used straight away, and Claude keeps your corrections when it next rebuilds.</p>
          <Textarea rows={24} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveBriefEdit(slug, text); if (r.ok) setEditing(false); else setMsg(r.message ?? "Couldn't save.") })}>
              {pending ? "Saving…" : "Save corrections"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {msg && <span className="text-xs text-rag-red">{msg}</span>}
          </div>
        </div>
      ) : (
        <div className="brief-prose space-y-1 px-5 py-4 text-sm leading-relaxed">
          <ReactMarkdown
            components={{
              h2: ({ children }) => <h3 className="mt-5 mb-2 border-b pb-1.5 text-xs font-semibold tracking-wide text-lime uppercase first:mt-0">{children}</h3>,
              h3: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold">{children}</h4>,
              ul: ({ children }) => <ul className="space-y-1.5">{children}</ul>,
              li: ({ children }) => <li className="relative pl-4 before:absolute before:top-2 before:left-0 before:size-1 before:rounded-full before:bg-foreground/40">{children}</li>,
              p: ({ children }) => <p className="text-muted-foreground">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="underline">{children}</a>,
              code: ({ children }) => {
                const t = String(children)
                return t.startsWith("§") ? <span className="ml-1 inline-block rounded border px-1.5 py-px align-middle text-[10px] text-subtle-foreground">{t.slice(1)}</span> : <code className="rounded bg-accent px-1 text-xs">{t}</code>
              },
            }}
          >
            {chipSources(brief.content)}
          </ReactMarkdown>
        </div>
      )}
    </section>
  )
}

function MustKnows({ slug, notes }: { slug: string; notes: Knowledge[] }) {
  const [kind, setKind] = useState<"target" | "constraint" | "note">("target")
  const [text, setText] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const add = () =>
    start(async () => {
      const r = await addNote(slug, kind, text)
      if (r.ok) setText("")
      setMsg(r.ok ? null : (r.message ?? "Couldn't save."))
    })
  return (
    <section className="surface overflow-hidden">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Must-knows</h3>
        <p className="text-xs text-muted-foreground">Short facts Claude must always follow: targets, rules, context.</p>
      </div>
      <ul className="divide-y">
        {notes.map((n) => (
          <li key={n.id} className="group flex items-start gap-2 px-4 py-2.5 text-sm">
            <span className={cn("mt-0.5 shrink-0 rounded-full border px-1.5 py-px text-[10px]", kindOf(n.category).cls)}>{kindOf(n.category).label}</span>
            <span className="min-w-0 flex-1 whitespace-pre-line">{n.title.length < 80 ? n.title : n.title + "…"}</span>
            <button type="button" onClick={() => start(async () => void (await removeNote(slug, n.id)))} className="shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground" aria-label="Remove">
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        {notes.length === 0 && <li className="px-4 py-4 text-xs text-muted-foreground">None yet. E.g. &ldquo;Q4 target: 120 SQLs&rdquo;, &ldquo;Never retarget existing customers&rdquo;.</li>}
      </ul>
      <div className="space-y-2 border-t p-3">
        <div className="flex gap-1">
          {NOTE_KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", kind === k.key ? k.cls + " bg-accent" : "text-muted-foreground")}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={kind === "target" ? "Q4 target: 120 SQLs" : kind === "constraint" ? "Legal won't approve competitor names in ads" : "Anything else worth knowing"} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30" aria-label="Must-know" />
          <Button size="sm" disabled={pending || !text.trim()} onClick={add}>
            Add
          </Button>
        </div>
        {msg && <p className="text-xs text-rag-red">{msg}</p>}
      </div>
    </section>
  )
}

function Files({ slug, files }: { slug: string; files: Knowledge[] }) {
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const upload = async (file: File) => {
    setMsg(null)
    setBusy(true)
    const type = file.type || (file.name.endsWith(".md") ? "text/markdown" : "")
    const s = await startUpload(slug, file.name, type, file.size)
    if (!s.ok || !s.path || !s.token) {
      setBusy(false)
      return setMsg(s.message ?? "Couldn't upload.")
    }
    const sb = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    const { error } = await sb.storage.from("client-files").uploadToSignedUrl(s.path, s.token, file, { contentType: type })
    const f = error ? { ok: false, message: "The upload failed." } : await finishUpload(slug, s.path, file.name, type, file.size)
    setBusy(false)
    if (!f.ok) setMsg(f.message ?? "Couldn't upload.")
    else router.refresh()
  }
  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Files</h3>
          <p className="text-xs text-muted-foreground">Decks, research, call notes. PDF, TXT, MD or CSV, up to 10 MB.</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
        <input ref={input} type="file" accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = "" }} />
      </div>
      <ul className="divide-y">
        {files.map((f) => (
          <li key={f.id} className="group flex items-center gap-2 px-4 py-2.5 text-sm">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={f.title}>{f.title}</span>
            <button type="button" onClick={async () => { await removeFile(slug, f.id); router.refresh() }} className="shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground" aria-label="Remove">
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        {files.length === 0 && <li className="px-4 py-4 text-xs text-muted-foreground">No files yet.</li>}
      </ul>
      {msg && <p className="border-t px-4 py-2 text-xs text-rag-red">{msg}</p>}
    </section>
  )
}

function HqSources({ slug, hqPageId, pages, canAdmin }: { slug: string; hqPageId: string | null; pages: Knowledge[]; canAdmin: boolean }) {
  const [showOff, setShowOff] = useState(false)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const on = pages.filter((p) => p.include)
  const off = pages.filter((p) => !p.include)
  const url = (id: string) => `https://www.notion.so/${id.replace(/-/g, "")}`
  const toggle = (p: Knowledge) => start(async () => { const r = await setHqPageIncluded(slug, p.id, !p.include); setMsg(r.ok ? (r.message ?? null) : (r.message ?? "Couldn't save.")) })
  const row = (p: Knowledge) => (
    <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <input type="checkbox" checked={p.include} disabled={!canAdmin || pending} onChange={() => toggle(p)} className="size-3.5 accent-lime" aria-label={`Use ${p.title}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {p.title}
          {p.notion_kind === "database" && <span className="ml-1.5 text-[10px] text-muted-foreground">database</span>}
        </span>
        {p.path && <span className="block truncate text-[11px] text-subtle-foreground">{p.path}</span>}
      </span>
      {p.error ? (
        <span className="shrink-0 text-[11px] text-rag-red" title={p.error}>Couldn&apos;t read</span>
      ) : (
        p.include && <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">{p.synced_at ? `${kchars(p.content_chars)} · read ${date(p.synced_at)}` : "Not read yet"}</span>
      )}
      <a href={url(p.notion_page_id!)} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] text-muted-foreground underline hover:text-foreground">
        Open
      </a>
    </li>
  )
  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">From the Notion HQ</h3>
          <p className="text-xs text-muted-foreground">
            {hqPageId ? (
              <>
                Read only. {on.length} of {pages.length} pages count toward the brief.{" "}
                <a href={url(hqPageId)} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  Open the HQ
                </a>
              </>
            ) : (
              "No HQ page linked for this client yet."
            )}
          </p>
        </div>
        {msg && <span className="text-xs text-lime">{msg}</span>}
      </div>
      <ul className="divide-y">{on.map(row)}</ul>
      {off.length > 0 && (
        <>
          <button type="button" onClick={() => setShowOff((s) => !s)} className="flex w-full items-center gap-1.5 border-t px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-3.5 transition-transform", showOff && "rotate-180")} /> {showOff ? "Hide" : "Show"} {off.length} pages left out
          </button>
          {showOff && <ul className="divide-y border-t">{off.map(row)}</ul>}
        </>
      )}
      {pages.length === 0 && hqPageId && <p className="px-4 py-4 text-xs text-muted-foreground">Not read yet. Refresh to find the HQ&apos;s pages.</p>}
    </section>
  )
}
