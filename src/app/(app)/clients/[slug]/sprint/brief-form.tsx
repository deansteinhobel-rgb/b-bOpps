"use client"

import { useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { Sparkle } from "@/components/fx/sparkle"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { commentBody } from "@/lib/notion/write"
import { longDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { briefOptions, briefTest, type BriefOptions, type BriefPerson } from "./test-actions"

const PRIORITY_OPTIONS = ["High", "Medium", "Low"] as const
type PriorityOption = (typeof PRIORITY_OPTIONS)[number]
const STEPS = ["Who and when", "Tag and comment", "Review and send"] as const

type Done = { ok: boolean; text: string; url?: string; dryRun?: boolean }

/**
 * "Brief the team" as a pop-up in three steps: 1) project leads, due date, priority; 2) who to tag
 * and the comment; 3) a review of exactly what goes to Notion. Nothing is sent before step 3, and
 * only then if live writes are on for this client.
 */
export function BriefDialog(props: { testId: string; live: boolean; disabled?: boolean; onDone: (r: Done) => void }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<BriefOptions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [leadIds, setLeadIds] = useState<string[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState("")
  const [priority, setPriority] = useState<PriorityOption>("Medium")
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [pending, start] = useTransition()

  const openDialog = () => {
    setOpen(true)
    setStep(0)
    setError(null)
    setDone(null)
    if (opts) return
    briefOptions(props.testId).then((r) => {
      if (!r.ok) return setLoadError(r.message)
      setOpts(r.options)
      setLeadIds(r.options.leadIds)
      setDueDate(r.options.dueDate ?? "")
      setPriority(r.options.priority)
      setComment(r.options.comment)
    })
  }
  const close = () => {
    setOpen(false)
    if (done) props.onDone(done)
  }

  const name = (id: string) => opts?.people.find((p) => p.id === id)?.name ?? "Unknown"
  const stepOk = [leadIds.length > 0 && Boolean(dueDate), true, true]
  const send = () =>
    start(async () => {
      setError(null)
      const r = await briefTest(props.testId, { leadIds, dueDate, priority, tagIds, comment })
      if (!r.ok && !r.url) return setError(r.message ?? "Couldn't brief.")
      setDone({ ok: r.ok, text: r.message ?? "Done", url: r.url, dryRun: r.dryRun })
    })

  return (
    <>
      <Sparkle>
        <Button size="sm" disabled={props.disabled} onClick={openDialog}>
          {props.live ? "Brief the team in Notion" : "Brief the team (test mode)"}
        </Button>
      </Sparkle>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Brief the team</DialogTitle>
            <DialogDescription>{opts ? opts.title : "A new row on Master Production, with a comment for the team."}</DialogDescription>
          </DialogHeader>

          {loadError ? (
            <p className="text-sm text-rag-red">{loadError}</p>
          ) : !opts ? (
            <p className="text-sm text-muted-foreground">Loading the Notion people…</p>
          ) : done ? (
            <DoneStep done={done} onClose={close} />
          ) : (
            <>
              <Stepper step={step} onPick={(i) => i < step && setStep(i)} />

              <div className="min-h-64 space-y-4">
                {step === 0 && (
                  <>
                    <PeoplePicker label="Project lead" people={opts.people} value={leadIds} onChange={setLeadIds} hint="The first one owns the test." />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`due-${props.testId}`}>Due date</Label>
                        <Input id={`due-${props.testId}`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`prio-${props.testId}`}>Priority</Label>
                        <select id={`prio-${props.testId}`} className={fieldClass} value={priority} onChange={(e) => setPriority(e.target.value as PriorityOption)}>
                          {PRIORITY_OPTIONS.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <PeoplePicker label="Tag in the comment" people={opts.people} value={tagIds} onChange={setTagIds} hint="They get a Notion notification." />
                    <div className="space-y-1">
                      <Label htmlFor={`comment-${props.testId}`}>Comment</Label>
                      <Textarea id={`comment-${props.testId}`} rows={11} value={comment} onChange={(e) => setComment(e.target.value)} />
                      <p className="text-xs text-muted-foreground">
                        {tagIds.length ? "Anyone you tag is greeted at the top, unless you write @ and their full name yourself." : "Leave it empty to skip the comment."}
                      </p>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <Review
                    rows={[
                      ["Project lead", leadIds.map(name).join(", ")],
                      ["Due", dueDate ? longDate(dueDate) : "Not set"],
                      ["Priority", priority],
                      ["Master Status", "New"],
                      ["Production Type", "Paid Media"],
                      ["Status Content", "Ready for Copy"],
                    ]}
                    comment={comment.trim() ? commentBody(comment, tagIds.map((id) => ({ id, name: name(id) }))) : null}
                    tagged={tagIds.map(name)}
                    live={opts.live}
                  />
                )}
              </div>

              {error && <p className="text-sm text-rag-red">{error}</p>}
              <div className="-mx-4 -mb-4 flex items-center justify-between gap-2 rounded-b-xl border-t bg-muted/50 p-4">
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => (step === 0 ? close() : setStep(step - 1))}>
                  {step === 0 ? "Cancel" : "Back"}
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button size="sm" disabled={!stepOk[step]} onClick={() => setStep(step + 1)}>
                    Next: {STEPS[step + 1].toLowerCase()}
                  </Button>
                ) : (
                  <Sparkle>
                    <Button size="sm" disabled={pending || !stepOk[0]} onClick={send}>
                      {pending ? "Sending…" : opts.live ? "Create in Notion" : "Preview (test mode)"}
                    </Button>
                  </Sparkle>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function Stepper({ step, onPick }: { step: number; onPick: (i: number) => void }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => onPick(i)}
            disabled={i >= step}
            aria-current={i === step ? "step" : undefined}
            className={cn("flex items-center gap-2 whitespace-nowrap", i < step && "cursor-pointer hover:underline", i > step && "text-muted-foreground")}
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full border text-[11px] font-semibold",
                i === step && "border-primary bg-primary text-primary-foreground",
                i < step && "border-primary text-primary",
              )}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={cn(i !== step && "hidden sm:inline")}>{label}</span>
          </button>
          {i < STEPS.length - 1 && <span className={cn("h-px flex-1 bg-border", i < step && "bg-primary/60")} />}
        </li>
      ))}
    </ol>
  )
}

function Review({ rows, comment, tagged, live }: { rows: [string, string][]; comment: string | null; tagged: string[]; live: boolean }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">The row</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">The full plan goes in Description of Request, with a link back to the test.</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">The comment{tagged.length ? `, tagging ${tagged.join(", ")}` : ""}</p>
        {comment ? (
          <p className="max-h-48 overflow-y-auto rounded-md border p-3 text-sm break-words whitespace-pre-line">
            {highlight(comment, tagged)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No comment.</p>
        )}
      </div>
      {!live && <p className="rounded-md bg-secondary/60 p-2 text-xs">Test mode: nothing is sent to Notion. You&apos;ll see this as a preview.</p>}
    </div>
  )
}

/** Shows each "@Name" of a tagged person as a mention chip, like Notion does. */
function highlight(text: string, names: string[]) {
  if (!names.length) return text
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => `@${n}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  return text.split(new RegExp(`(${escaped.join("|")})`)).map((part, i) =>
    names.some((n) => part === `@${n}`) ? (
      <span key={i} className="rounded bg-primary/15 px-1 text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

function DoneStep({ done, onClose }: { done: Done; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <p className={cn("text-sm", !done.ok && "text-rag-amber")}>{done.text}</p>
      <div className="flex justify-end gap-2">
        {done.url && (
          <a href={done.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-secondary">
            Open in Notion
          </a>
        )}
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}

function PeoplePicker(props: { label: string; people: BriefPerson[]; value: string[]; onChange: (ids: string[]) => void; hint?: string }) {
  const [q, setQ] = useState("")
  const chosen = props.value.map((id) => props.people.find((p) => p.id === id)).filter((p): p is BriefPerson => Boolean(p))
  const matches = props.people.filter((p) => !props.value.includes(p.id) && (q ? p.name.toLowerCase().includes(q.toLowerCase()) : p.onTeam)).slice(0, 6)
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">
        {props.label}
        {props.hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{props.hint}</span>}
      </p>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chosen.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => props.onChange(props.value.filter((id) => id !== p.id))}
              className="rounded-full border bg-secondary px-2 py-0.5 text-xs hover:border-rag-red"
              title={`Remove ${p.name}`}
            >
              {p.name} ×
            </button>
          ))}
        </div>
      )}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Notion people…" aria-label={`${props.label}: search`} />
      {matches.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  props.onChange([...props.value, p.id])
                  setQ("")
                }}
                className={cn("rounded-full border px-2 py-0.5 text-xs hover:bg-secondary", p.onTeam && "border-primary/40")}
              >
                + {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!q && matches.length > 0 && <p className="text-xs text-muted-foreground">The client&apos;s team is shown first. Search for anyone else in Notion.</p>}
    </div>
  )
}
