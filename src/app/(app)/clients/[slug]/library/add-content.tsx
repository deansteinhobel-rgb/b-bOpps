"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Spinner } from "@/components/loading"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { STAGES, typeFromUrl, type LibraryConfig, type Stage } from "@/lib/content-library/config"
import type { LibraryPiece } from "@/lib/content-library/load"
import type { Placement } from "@/lib/content-library/suggestions"
import { cn } from "@/lib/utils"
import { addPiece } from "./actions"
import { readPage, suggestPlacement, type Signed } from "./claude-api"

type Step = "details" | "thinking" | "review"
type Email = { slot: 1 | 2 | 3; target: string | null; angle: string }
type Change = { engagedId: string; slot: 1 | 2 | 3; angle: string; reason: string; from: string | null; on: boolean }

const field = "h-9 w-full min-w-0 rounded-lg border border-input bg-input/30 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
const area = "w-full rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
const emptyEmails = (): Email[] => [1, 2, 3].map((slot) => ({ slot: slot as 1 | 2 | 3, target: null, angle: "" }))

function Chips({ list, picked, onChange }: { list: readonly string[]; picked: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {list.map((v) => {
        const on = picked.includes(v)
        return (
          <label key={v} className={cn("pill cursor-pointer select-none", on && "pill-active")}>
            <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? picked.filter((x) => x !== v) : [...picked, v])} />
            {v}
          </label>
        )
      })}
    </div>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** "Add content": the basics, Claude's placement (theme, stage, sequence, changes to others), review, save. */
export function AddContent({ cfg, clientSlug, pieces, aiEnabled }: { cfg: LibraryConfig; clientSlug: string; pieces: LibraryPiece[]; aiEnabled: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("details")
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()

  // Details
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [type, setType] = useState<string>(cfg.types[0])
  const [audiences, setAudiences] = useState<string[]>([cfg.audiences[0]])
  const [notes, setNotes] = useState("")
  const [page, setPage] = useState<{ text: string; description: string; words: number; url: string; title: string } | null>(null)
  const [reading, setReading] = useState(false)
  const [readMsg, setReadMsg] = useState<string | null>(null)

  // Review
  const [theme, setTheme] = useState("")
  const [stage, setStage] = useState<Stage>("Awareness")
  const [purpose, setPurpose] = useState("")
  const [verticals, setVerticals] = useState<string[]>([])
  const [emails, setEmails] = useState<Email[]>(emptyEmails)
  const [changes, setChanges] = useState<Change[]>([])
  const [signed, setSigned] = useState<Signed | null>(null)
  const abort = useRef<AbortController | null>(null)

  const byId = new Map(pieces.map((p) => [p.id, p]))
  const themes = [...new Set(pieces.map((p) => p.theme).filter((t): t is string => Boolean(t)))].sort()

  const reset = () => {
    setStep("details")
    setError(null)
    setUrl("")
    setTitle("")
    setType(cfg.types[0])
    setAudiences([cfg.audiences[0]])
    setNotes("")
    setPage(null)
    setReadMsg(null)
    setTheme("")
    setStage("Awareness")
    setPurpose("")
    setVerticals([])
    setEmails(emptyEmails())
    setChanges([])
    setSigned(null)
  }

  type ReadPage = { text: string; description: string; words: number; url: string; title: string }
  /** Reads the page; returns it (with the title to use), or null with the reason shown under the link. */
  const read = async (): Promise<ReadPage | null> => {
    if (!url.trim()) return setReadMsg("Add the page link first."), null
    setReading(true)
    setReadMsg(null)
    try {
      const { page: p } = await readPage(clientSlug, url.trim())
      const finalUrl = p.canonicalUrl ?? url.trim()
      const read = { text: p.text, description: p.description, words: p.words, url: finalUrl, title: title.trim() || p.title.replace(/\s*[|–-]\s*[^|–-]{1,30}$/, "").trim() }
      setUrl(finalUrl)
      setPage(read)
      setTitle(read.title)
      const t = typeFromUrl(cfg, finalUrl)
      if (t) setType(t)
      setReadMsg(`Read from the page: ${p.words.toLocaleString("en-US")} words.`)
      return read
    } catch (e) {
      setPage(null)
      setReadMsg((e as Error).message)
      return null
    } finally {
      setReading(false)
    }
  }

  const fillInMyself = () => {
    if (!title.trim() || !audiences.length) return setError("Add a title and who it's written for.")
    setError(null)
    setSigned(null)
    setStep("review")
  }

  const suggest = async () => {
    // A link that hasn't been read yet is read first, so Claude works from the page itself.
    const got = page && page.url === url.trim() ? page : url.trim() ? await read() : null
    const finalTitle = got?.title || title.trim()
    if (!finalTitle || !audiences.length) return setError("Add a title and who it's written for.")
    setError(null)
    setStep("thinking")
    abort.current = new AbortController()
    try {
      const r = await suggestPlacement(
        clientSlug,
        { title: finalTitle, url: (got?.url ?? url.trim()) || null, type: got ? (typeFromUrl(cfg, got.url) ?? type) : type, audiences, notes, pageDescription: got?.description || undefined, pageText: got?.text || undefined },
        abort.current.signal,
      )
      apply(r.placement, r.signed)
    } catch (e) {
      if (abort.current?.signal.aborted) return
      setError((e as Error).message)
      setStep("details")
    } finally {
      abort.current = null
    }
  }

  const idOf = (code: string | null) => (code ? (pieces.find((p) => p.code === code)?.id ?? null) : null)
  const apply = (p: Placement, s: Signed) => {
    setTheme(p.theme)
    setStage(p.stage)
    setPurpose(p.purpose)
    setVerticals(p.verticals)
    setEmails(p.sequence.map((e) => ({ slot: e.slot, target: e.target === "handoff" ? "handoff" : idOf(e.target), angle: e.angle })))
    setChanges(
      p.changes
        .map((c) => {
          const engaged = pieces.find((x) => x.code === c.engaged)
          if (!engaged) return null
          const cur = engaged.emails.find((e) => e.slot === c.slot)
          return { engagedId: engaged.id, slot: c.slot, angle: c.angle, reason: c.reason, from: cur?.handoff ? "the sales handoff" : cur?.targetId ? (byId.get(cur.targetId)?.title ?? "removed content") : null, on: true }
        })
        .filter((c): c is Change => c !== null),
    )
    setSigned(s)
    setStep("review")
  }

  const save = () =>
    startSave(async () => {
      const r = await addPiece({
        clientSlug,
        title: title.trim(),
        url: url.trim(),
        type,
        theme: theme.trim(),
        stage,
        audiences,
        verticals,
        purpose: purpose.trim(),
        sequence: emails.map((e) => ({ slot: e.slot, target: e.target, angle: e.angle })),
        changes: changes.filter((c) => c.on).map((c) => ({ engagedId: c.engagedId, slot: c.slot, angle: c.angle })),
        suggestion: signed,
      })
      if (!r.ok) return void setError(r.message)
      toast.success(r.message ?? "Added")
      setOpen(false)
      reset()
      router.refresh()
    })

  const setEmail = (slot: number, patch: Partial<Email>) => setEmails((all) => all.map((e) => (e.slot === slot ? { ...e, ...patch } : e)))

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="size-3.5" aria-hidden />
        Add content
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) abort.current?.abort()
          setOpen(o)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {step === "details" && (
            <>
              <DialogHeader>
                <DialogTitle>Add content</DialogTitle>
                <DialogDescription>
                  {aiEnabled ? "Add the basics. Claude reads the library, classifies the piece, builds its follow-up sequence and suggests where it fits in existing ones. You review everything before it's saved." : "Add the basics, then set its theme and sequence."}
                </DialogDescription>
              </DialogHeader>
              {error && <p className="text-sm text-rag-red">{error}</p>}
              <Field label="Page link" htmlFor="ac-url" hint={readMsg ?? `Paste a ${cfg.pageHosts[0]} link and Lumaux reads the page.`}>
                <div className="flex gap-2">
                  <Input
                    id="ac-url"
                    type="url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value)
                      setPage(null)
                      setReadMsg(null)
                    }}
                    placeholder={`https://${cfg.pageHosts[0]}/…`}
                  />
                  <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={reading || !url.trim()} onClick={() => void read()}>
                    {reading ? "Reading…" : "Read page"}
                  </Button>
                </div>
              </Field>
              <Field label="Title" htmlFor="ac-title">
                <Input id="ac-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Type" htmlFor="ac-type">
                <select id="ac-type" value={type} onChange={(e) => setType(e.target.value)} className={field}>
                  {cfg.types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Written for">
                <Chips list={cfg.audiences} picked={audiences} onChange={setAudiences} />
              </Field>
              <Field label={page ? "Anything Claude should know (optional)" : "What it covers"} htmlFor="ac-notes" hint={page ? undefined : "If the page can't be read, paste its text here instead."}>
                <textarea
                  id="ac-notes"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={5000}
                  className={area}
                  placeholder={page ? "e.g. who it's aimed at or which campaign it's for" : "Paste the page text, or a sentence or two about it"}
                />
              </Field>
              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <div className="flex gap-2">
                  {aiEnabled ? (
                    <>
                      <Button variant="outline" size="sm" onClick={fillInMyself}>
                        Fill in myself
                      </Button>
                      <Button size="sm" onClick={() => void suggest()} disabled={reading}>
                        Suggest placement
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={fillInMyself}>
                      Continue
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          {step === "thinking" && (
            <>
              <DialogHeader>
                <DialogTitle>Finding where it fits</DialogTitle>
                <DialogDescription>Claude is reading the library and the current sequences. This usually takes under a minute.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
                <Spinner label="Finding where it fits" />
                <span>Reading the library…</span>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    abort.current?.abort()
                    fillInMyself()
                  }}
                >
                  Stop and fill in myself
                </Button>
              </div>
            </>
          )}

          {step === "review" && (
            <>
              <DialogHeader>
                <DialogTitle>Review and save</DialogTitle>
                <DialogDescription>
                  {title.trim()}. {signed ? "Claude's suggestions are filled in. Change anything before saving." : "Set its theme, stage and sequence."}
                </DialogDescription>
              </DialogHeader>
              {error && <p className="text-sm text-rag-red">{error}</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Theme" htmlFor="ac-theme">
                  <Input id="ac-theme" list="ac-themes" value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={80} />
                  <datalist id="ac-themes">
                    {themes.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Funnel stage" htmlFor="ac-stage">
                  <select id="ac-stage" value={stage} onChange={(e) => setStage(e.target.value as Stage)} className={field}>
                    {STAGES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="What it's for" htmlFor="ac-purpose">
                <textarea id="ac-purpose" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={400} className={area} />
              </Field>
              <Field label="Verticals">
                <Chips list={cfg.verticals} picked={verticals} onChange={setVerticals} />
              </Field>

              <div className="space-y-2">
                <div>
                  <h3 className="font-semibold text-foreground">Its follow-up sequence</h3>
                  <p className="text-xs text-muted-foreground">What to send someone who engages with this piece, and the angle for each email.</p>
                </div>
                {emails.map((e) => (
                  <div key={e.slot} className="grid gap-2 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center">
                    <span className="text-xs text-muted-foreground">Email {e.slot}</span>
                    <select aria-label={`Email ${e.slot}`} value={e.target ?? ""} onChange={(ev) => setEmail(e.slot, { target: ev.target.value || null })} className={field}>
                      <option value="">Not set</option>
                      {pieces.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                      {e.slot === 3 && <option value="handoff">Sales handoff</option>}
                    </select>
                    <Input aria-label={`Angle for email ${e.slot}`} value={e.angle} onChange={(ev) => setEmail(e.slot, { angle: ev.target.value })} placeholder="Email angle" maxLength={300} />
                  </div>
                ))}
              </div>

              {changes.length > 0 && (
                <div className="space-y-2">
                  <div>
                    <h3 className="font-semibold text-foreground">Add it to existing sequences</h3>
                    <p className="text-xs text-muted-foreground">Untick anything you don&apos;t want changed. A changed sequence goes back for approval.</p>
                  </div>
                  {changes.map((c, i) => (
                    <label key={`${c.engagedId}-${c.slot}`} className="flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors hover:border-border-strong">
                      <input type="checkbox" className="mt-1 accent-lime" checked={c.on} onChange={() => setChanges((all) => all.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block">
                          Send it as email {c.slot} after <span className="font-medium">{byId.get(c.engagedId)?.title}</span>
                        </span>
                        {c.angle && <span className="block text-xs text-body">Angle: {c.angle}</span>}
                        <span className="block text-xs text-muted-foreground">
                          Replaces {c.from ?? "nothing set"}.{c.reason ? ` ${c.reason}` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("details")} disabled={saving}>
                  Back
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save to library"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
