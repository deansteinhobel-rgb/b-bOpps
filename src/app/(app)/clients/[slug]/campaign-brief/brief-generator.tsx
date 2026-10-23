"use client"

import { AlertTriangle, ArrowLeft, Check as CheckIcon, Download, ExternalLink } from "lucide-react"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { fieldClass } from "@/components/field-class"
import { Spinner } from "@/components/loading"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { boldRuns, briefBlocks, type DocBlock } from "@/lib/campaign-brief/document"
import { notionBriefTitle, totalAds, type BriefQuestion, type BriefStatus, type CampaignBrief } from "@/lib/campaign-brief/schema"
import { shortDate } from "@/lib/format"
import { PRIORITIES, type Priority } from "@/lib/notion/config"
import { cn } from "@/lib/utils"
import { archiveBrief, sendBriefToNotion } from "./actions"

export type BriefRow = {
  id: string
  request: string
  notes: string | null
  status: BriefStatus
  questions: BriefQuestion[]
  answers: Record<string, string>
  brief: CampaignBrief | null
  error: string | null
  notionUrl: string | null
  createdAt: string
  by: string | null
}

type NotionSetup = { leads: { notionUserId: string; name: string; onTeam: boolean }[]; defaultLead: string | null; live: boolean }
type Props = { slug: string; clientName: string; briefs: BriefRow[]; openId: string | null; canEdit: boolean; aiReady: boolean; notion: NotionSetup }

const STATUS: Record<BriefStatus, string> = { asking: "Thinking", questions: "Questions", writing: "Writing", ready: "Ready", failed: "Failed" }
const working = (s: BriefStatus) => s === "asking" || s === "writing"

async function post(body: object): Promise<{ briefId?: string; error?: string }> {
  const r = await fetch("/api/campaign-brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null)
  if (!r) return { error: "Couldn't reach Lumaux. Check your connection and try again." }
  return (await r.json().catch(() => ({}))) as { briefId?: string; error?: string }
}

/** Planning › Generate a campaign brief: the request form and past briefs on the left, the open brief on the right. */
export function BriefGenerator(p: Props) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(p.openId ?? p.briefs[0]?.id ?? null)
  const open = p.briefs.find((b) => b.id === openId) ?? null
  const show = (id: string | null) => {
    setOpenId(id)
    router.replace(id ? `?brief=${id}` : "?", { scroll: false })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-6">
        <NewBrief {...p} onStarted={(id) => show(id)} />
        {p.briefs.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl">Briefs</h2>
            <ul className="surface divide-y">
              {p.briefs.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => show(b.id)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]", b.id === openId && "bg-white/[0.05]")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{b.brief?.title ?? b.request}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {shortDate(b.createdAt.slice(0, 10))}
                        {b.by ? ` · ${b.by}` : ""}
                      </span>
                    </span>
                    <span className="pill">{b.notionUrl ? "In Notion" : STATUS[b.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="min-w-0">
        {open ? (
          <BriefPanel key={open.id} row={open} {...p} onArchived={() => show(null)} />
        ) : (
          <div className="surface px-6 py-12 text-center text-sm text-muted-foreground">Your brief shows here. Start with what the campaign is for, on the left.</div>
        )}
      </div>
    </div>
  )
}

function NewBrief(p: Props & { onStarted: (id: string) => void }) {
  const [request, setRequest] = useState("")
  const [notes, setNotes] = useState("")
  const [showNotes, setShowNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const disabled = !p.canEdit ? "You have view access" : !p.aiReady ? "Claude isn't set up (ANTHROPIC_API_KEY)" : null

  const start = async () => {
    setBusy(true)
    setError(null)
    const r = await post({ slug: p.slug, request, notes })
    setBusy(false)
    if (!r.briefId) return setError(r.error ?? "Couldn't start the brief.")
    setRequest("")
    setNotes("")
    p.onStarted(r.briefId)
    router.refresh()
  }

  return (
    <section className="surface space-y-3 p-4">
      <h2 className="text-xl">New brief</h2>
      <label className="block space-y-1.5 text-xs text-muted-foreground">
        What&apos;s the campaign for?
        <Textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder={`e.g. An MSP campaign for ${p.clientName}: get managed service providers to sign up as partners`}
          className="text-sm text-foreground"
        />
      </label>
      {showNotes ? (
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          Notes, a proposal or a client email (optional)
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} maxLength={20000} className="text-sm text-foreground" />
        </label>
      ) : (
        <button type="button" onClick={() => setShowNotes(true)} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Add notes or paste a proposal
        </button>
      )}
      {error && <p className="text-[13px] text-rag-red">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={start} disabled={busy || request.trim().length < 3 || Boolean(disabled)} title={disabled ?? undefined}>
          {busy ? "Starting…" : "Generate brief"}
        </Button>
      </div>
    </section>
  )
}

/** Polls a brief while Claude works on it, then refreshes the page. */
function useBriefPoll(briefId: string, active: boolean) {
  const router = useRouter()
  const refresh = useRef(router.refresh)
  useEffect(() => {
    refresh.current = router.refresh
  })
  useEffect(() => {
    if (!active) return
    let stop = false
    const tick = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 3000))
        const r = await fetch(`/api/campaign-brief?brief=${briefId}`).catch(() => null)
        const json = r ? ((await r.json().catch(() => null)) as { status?: BriefStatus } | null) : null
        if (json?.status && !working(json.status)) {
          refresh.current()
          return
        }
      }
    }
    void tick()
    return () => {
      stop = true
    }
  }, [briefId, active])
}

function BriefPanel(p: Props & { row: BriefRow; onArchived: () => void }) {
  const row = p.row
  useBriefPoll(row.id, working(row.status))
  const [pending, start] = useTransition()
  const archive = () =>
    start(async () => {
      const r = await archiveBrief({ clientSlug: p.slug, briefId: row.id })
      if (!r.ok) return void toast.error(r.message)
      toast.success(r.message)
      p.onArchived()
    })

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="eyebrow">Campaign brief</div>
          <h2 className="text-2xl">{row.brief?.title ?? "New brief"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{row.request}</p>
        </div>
        {p.canEdit && (
          <Button variant="ghost" size="sm" onClick={archive} disabled={pending || working(row.status)}>
            Archive
          </Button>
        )}
      </div>

      {row.status === "asking" && (
        <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
          <Spinner label="Thinking" /> Reading everything we know about {p.clientName}, then a few questions. About 30 seconds.
        </div>
      )}
      {row.status === "writing" && (
        <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
          <Spinner label="Writing" /> Writing the brief. A minute or two.
        </div>
      )}
      {row.status === "failed" && <Failed row={row} canEdit={p.canEdit} />}
      {row.status === "questions" && row.questions.length > 0 && <Questions row={row} canEdit={p.canEdit} />}
      {row.brief && row.status !== "writing" && <ReadyBrief {...p} brief={row.brief} />}
    </section>
  )
}

function Failed({ row, canEdit }: { row: BriefRow; canEdit: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const retry = async () => {
    setBusy(true)
    const r = await post({ briefId: row.id, answers: {} })
    setBusy(false)
    if (r.error) return setError(r.error)
    router.refresh()
  }
  return (
    <div className="flex flex-wrap items-start gap-3 px-5 py-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rag-red" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-rag-red">{error ?? row.error ?? "The brief failed."}</p>
      <Button size="sm" variant="outline" onClick={retry} disabled={busy || !canEdit}>
        {busy ? "Starting…" : "Try again"}
      </Button>
    </div>
  )
}

/** Claude's questions as a pop-up, one per slide: tap an answer or type one. Opens by itself. */
function Questions({ row, canEdit }: { row: BriefRow; canEdit: boolean }) {
  const qs = row.questions
  const [open, setOpen] = useState(canEdit)
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>(row.answers)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const q = qs[Math.min(at, qs.length - 1)]
  const last = at >= qs.length - 1
  const answered = qs.filter((x) => answers[x.id]?.trim()).length

  const send = async () => {
    setBusy(true)
    setError(null)
    const r = await post({ briefId: row.id, answers })
    setBusy(false)
    if (r.error) return setError(r.error)
    setOpen(false)
    router.refresh()
  }
  const next = () => (last ? void send() : setAt(at + 1))
  const pick = (o: string) => {
    setAnswers({ ...answers, [q.id]: o })
    if (!last) setTimeout(() => setAt((i) => Math.min(i + 1, qs.length - 1)), 180)
  }

  return (
    <>
      <div className="flex items-center gap-3 px-5 py-4">
        <span className="flex-1 text-sm text-body">
          {qs.length} question{qs.length === 1 ? "" : "s"} before Claude writes the brief{answered ? ` · ${answered} answered` : ""}
        </span>
        <Button size="sm" onClick={() => setOpen(true)} disabled={!canEdit}>
          Answer
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] gap-6 p-6 sm:max-w-lg">
          <div className="flex gap-1.5 pr-8" aria-hidden>
            {qs.map((x, j) => (
              <span key={x.id} className={cn("h-1 flex-1 rounded-full transition-colors", j <= at ? "bg-lime" : "bg-white/10")} />
            ))}
          </div>
          <div key={q.id} className="space-y-4 animate-in fade-in-0 slide-in-from-right-4 duration-200">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {at + 1} of {qs.length}
              </p>
              <DialogTitle className="font-sans text-lg leading-snug font-semibold">{q.question}</DialogTitle>
              {q.why && <DialogDescription className="text-[13px]">{q.why}</DialogDescription>}
            </div>
            {q.options.length > 0 && (
              <div className="grid gap-2">
                {q.options.map((o) => {
                  const on = answers[q.id] === o
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => pick(o)}
                      aria-pressed={on}
                      className={cn("flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-lime focus-visible:outline-none", on && "border-lime/70 bg-white/[0.04] text-foreground")}
                    >
                      {o}
                      {on && <CheckIcon className="size-4 text-lime" aria-hidden />}
                    </button>
                  )
                })}
              </div>
            )}
            <Input
              aria-label="Your answer"
              value={q.options.includes(answers[q.id] ?? "") ? "" : (answers[q.id] ?? "")}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder={q.options.length ? "Or type your own" : "Your answer"}
              autoFocus={!q.options.length}
            />
          </div>
          {error && <p className="text-[13px] text-rag-red">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAt(at - 1)} disabled={at === 0} className={cn(at === 0 && "invisible")}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            <div className="flex gap-2">
              {!last && (
                <Button variant="outline" size="sm" onClick={() => setAt(at + 1)}>
                  Skip
                </Button>
              )}
              <Button size="sm" onClick={next} disabled={busy}>
                {last ? (busy ? "Starting…" : "Write the brief") : "Next"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReadyBrief(p: Props & { row: BriefRow; brief: CampaignBrief }) {
  const b = p.brief
  const blocks = briefBlocks(b, { clientName: p.clientName, createdOn: p.row.createdAt.slice(0, 10) })
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-5 py-3 text-sm">
        <Stat label="Ads" value={totalAds(b)} />
        <Stat label="Channels" value={b.channels.length} />
        <Stat label="A/B tests" value={b.abTests.length} />
        <div className="ml-auto flex flex-wrap gap-2">
          <a href={`/api/campaign-brief/docx?brief=${p.row.id}`} download className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Download aria-hidden /> Word
          </a>
          {p.row.notionUrl ? (
            <a href={p.row.notionUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ExternalLink aria-hidden /> Open in Notion
            </a>
          ) : (
            <SendToNotion {...p} />
          )}
        </div>
      </div>
      <BriefBody blocks={blocks.slice(3)} summary={b.summary} />
      {p.canEdit && <Revise row={p.row} />}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-muted-foreground">
      <span className="mr-1.5 text-lg text-foreground tabular-nums">{value}</span>
      {label}
    </span>
  )
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((r, i) =>
        r.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            {r.text}
          </strong>
        ) : (
          <Fragment key={i}>{r.text}</Fragment>
        ),
      )}
    </>
  )
}

/** The brief as it goes to Notion and Word (the same blocks), minus the title and meta line the header shows. */
function BriefBody({ blocks, summary }: { blocks: DocBlock[]; summary: string }) {
  // Consecutive bullets become one list.
  const groups: (DocBlock | { t: "list"; items: string[] })[] = []
  for (const b of blocks) {
    const prev = groups.at(-1)
    if (b.t === "bullet") {
      if (prev?.t === "list") prev.items.push(b.text)
      else groups.push({ t: "list", items: [b.text] })
    } else groups.push(b)
  }
  return (
    <div className="space-y-3 px-5 py-5 text-sm leading-relaxed text-body">
      <p className="text-base text-foreground">{summary}</p>
      {groups.map((g, i) => {
        if (g.t === "list")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {g.items.map((x, j) => (
                <li key={j}>
                  <Rich text={x} />
                </li>
              ))}
            </ul>
          )
        if (g.t === "h2") return <h3 key={i} className="pt-4 text-xl text-foreground">{g.text}</h3>
        if (g.t === "h3") return <h4 key={i} className="pt-2 text-[15px] font-semibold text-foreground">{g.text}</h4>
        if (g.t === "table")
          return (
            <div key={i} className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-white/[0.04] text-xs text-muted-foreground">
                  <tr>
                    {g.head.map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {g.rows.map((r, j) => (
                    <tr key={j} className="align-top">
                      {r.map((c, k) => (
                        <td key={k} className={cn("px-3 py-2", k === 0 && "text-foreground")}>
                          {c || "–"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        if (g.t === "p") return <p key={i}><Rich text={g.text} /></p>
        return null
      })}
    </div>
  )
}

function Revise({ row }: { row: BriefRow }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const send = async () => {
    setBusy(true)
    setError(null)
    const r = await post({ briefId: row.id, revision: text })
    setBusy(false)
    if (r.error) return setError(r.error)
    setText("")
    router.refresh()
  }
  return (
    <div className="space-y-2 border-t px-5 py-4">
      <label className="block space-y-1.5 text-xs text-muted-foreground">
        Change something
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} placeholder="e.g. Drop Reddit, add a video test on LinkedIn, and keep the budget under $15k" className="text-sm text-foreground" />
      </label>
      {error && <p className="text-[13px] text-rag-red">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={send} disabled={busy || text.trim().length < 3 || Boolean(row.notionUrl)} title={row.notionUrl ? "Already in Notion: start a new brief to change it" : undefined}>
          {busy ? "Starting…" : "Rewrite the brief"}
        </Button>
      </div>
    </div>
  )
}

/** "Send to Notion": pick the Project Lead, due date and priority, see what's created, send. */
function SendToNotion(p: Props & { row: BriefRow; brief: CampaignBrief }) {
  const { leads, defaultLead, live } = p.notion
  const [open, setOpen] = useState(false)
  const [lead, setLead] = useState(defaultLead ?? leads[0]?.notionUserId ?? "")
  const [due, setDue] = useState("")
  const [priority, setPriority] = useState<Priority | "">("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  const send = () =>
    start(async () => {
      setError(null)
      const r = await sendBriefToNotion({ clientSlug: p.slug, briefId: p.row.id, ownerNotionId: lead, dueDate: due || null, priority: priority || null })
      if (!r.ok) return void setError(r.message)
      toast.success(r.message)
      setOpen(false)
      router.refresh()
    })

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={!p.canEdit}>
        Send to Notion
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send the brief to Notion</DialogTitle>
            <DialogDescription>
              This creates one page on Master Production, &ldquo;{notionBriefTitle(p.brief)}&rdquo;: Production Type Paid Media, Master Status New, with the whole brief as the page&apos;s content.
              {!live && " Test mode is on, so it's logged and nothing is sent to Notion."}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="rounded-md bg-rag-red-bg px-3 py-2 text-sm text-rag-red">{error}</p>}
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is linked to a Notion user yet, so the brief has no one to lead it. An admin can link people in Admin → People.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5 text-xs text-muted-foreground sm:col-span-3">
                Project Lead
                <select value={lead} onChange={(e) => setLead(e.target.value)} className={fieldClass}>
                  {leads.map((l) => (
                    <option key={l.notionUserId} value={l.notionUserId}>
                      {l.name}
                      {l.onTeam ? "" : " (not on the team)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground sm:col-span-2">
                Due date (optional)
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                Priority
                <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")} className={fieldClass}>
                  <option value="">None</option>
                  {PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send} disabled={pending || !lead}>
              {pending ? "Sending…" : live ? "Send to Notion" : "Send (test mode)"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
