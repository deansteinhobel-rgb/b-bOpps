"use client"

import { useState, useTransition } from "react"
import { PlatformIcon } from "@/components/brand"
import { fieldClass } from "@/components/field-class"
import { Sparkle } from "@/components/fx/sparkle"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { longDate } from "@/lib/format"
import { commentBody } from "@/lib/notion/write"
import { emptyNeeds, hasNeeds, NEEDS, NEEDS_PLATFORMS, needsText, TEMPLATES, type Needs } from "@/lib/sprints/brief-needs"
import { briefComment } from "@/lib/sprints/tests"
import { cn } from "@/lib/utils"
import { briefOptions, briefTest, type BriefOptions, type BriefPerson } from "./test-actions"

const PRIORITY_OPTIONS = ["High", "Medium", "Low"] as const
type PriorityOption = (typeof PRIORITY_OPTIONS)[number]
const STEPS = ["Who and when", "What we need", "Tag and comment", "Review and send"] as const

type Done = { ok: boolean; text: string; url?: string; dryRun?: boolean }

/**
 * "Brief the team" as a pop-up in four steps: 1) project leads, due date, priority; 2) what we need
 * (the platform's ad formats, quantities, lead form copy, notes); 3) who to tag and the comment,
 * drafted from step 2; 4) a review of exactly what goes to Notion. Nothing is sent before step 4,
 * and only then if live writes are on for this client.
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
  const [needs, setNeeds] = useState<Needs>(emptyNeeds("linkedin"))
  const [comment, setComment] = useState("")
  const [commentEdited, setCommentEdited] = useState(false)
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
      setNeeds(emptyNeeds(r.options.platform))
    })
  }
  const close = () => {
    setOpen(false)
    if (done) props.onDone(done)
  }

  const name = (id: string) => opts?.people.find((p) => p.id === id)?.name ?? "Unknown"
  const stepOk = [leadIds.length > 0 && Boolean(dueDate), hasNeeds(needs), true, true]
  const draft = () =>
    opts ? briefComment({ ...opts.commentParts, platformLabel: NEEDS[needs.platform].label, needs: needsText(needs), deadline: dueDate ? longDate(dueDate) : null }) : ""
  const goTo = (i: number) => {
    // The comment follows the answers until someone edits it by hand.
    if (i === 2 && !commentEdited) setComment(draft())
    setStep(i)
  }
  const send = () =>
    start(async () => {
      setError(null)
      const r = await briefTest(props.testId, { leadIds, dueDate, priority, tagIds, comment, needs })
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
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
              <Stepper step={step} onPick={(i) => i < step && goTo(i)} />

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

                {step === 1 && <NeedsStep needs={needs} onChange={setNeeds} />}

                {step === 2 && (
                  <>
                    <PeoplePicker label="Tag in the comment" people={opts.people} value={tagIds} onChange={setTagIds} hint="They get a Notion notification." />
                    <div className="space-y-1">
                      <Label htmlFor={`comment-${props.testId}`}>Comment</Label>
                      <Textarea
                        id={`comment-${props.testId}`}
                        rows={12}
                        value={comment}
                        onChange={(e) => {
                          setComment(e.target.value)
                          setCommentEdited(true)
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {tagIds.length ? "Anyone you tag is greeted at the top, unless you write @ and their full name yourself. " : "Leave it empty to skip the comment. "}
                        {commentEdited && (
                          <button
                            type="button"
                            className="underline"
                            onClick={() => {
                              setComment(draft())
                              setCommentEdited(false)
                            }}
                          >
                            Redraft from my answers
                          </button>
                        )}
                      </p>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <Review
                    rows={[
                      ["Platform", NEEDS[needs.platform].label],
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
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => (step === 0 ? close() : goTo(step - 1))}>
                  {step === 0 ? "Cancel" : "Back"}
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button size="sm" disabled={!stepOk[step]} onClick={() => goTo(step + 1)}>
                    Next: {STEPS[step + 1].toLowerCase()}
                  </Button>
                ) : (
                  <Sparkle>
                    <Button size="sm" disabled={pending || !stepOk[0] || !stepOk[1]} onClick={send}>
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

function NeedsStep({ needs, onChange }: { needs: Needs; onChange: (n: Needs) => void }) {
  const def = NEEDS[needs.platform]
  const set = (patch: Partial<Needs>) => onChange({ ...needs, ...patch })
  const templates = def.formats.filter((f) => f.template && needs.formats[f.key])
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Platform</p>
        <div className="flex flex-wrap gap-1.5">
          {NEEDS_PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={needs.platform === p}
              onClick={() => p !== needs.platform && onChange({ ...emptyNeeds(p), notes: needs.notes, designNotes: needs.designNotes })}
              className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", needs.platform === p ? "border-primary bg-primary/10" : "hover:bg-secondary")}
            >
              <PlatformIcon platform={p} className="size-4" />
              {NEEDS[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          Which ads?<span className="ml-2 text-xs font-normal text-muted-foreground">Pick all that apply{def.quantities ? ", then how many" : ""}.</span>
        </p>
        <ul className="divide-y rounded-md border">
          {def.formats.map((f) => {
            const on = Boolean(needs.formats[f.key])
            return (
              <li key={f.key} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={on}
                    onChange={(e) => {
                      const formats = { ...needs.formats }
                      if (e.target.checked) formats[f.key] = 1
                      else delete formats[f.key]
                      set({ formats })
                    }}
                  />
                  {f.label}
                  {!f.design && <span className="text-xs text-muted-foreground">copy only</span>}
                </label>
                {on && def.quantities && <Qty label={`How many: ${f.label}`} value={needs.formats[f.key]} onChange={(v) => set({ formats: { ...needs.formats, [f.key]: v } })} />}
              </li>
            )
          })}
        </ul>
        {templates.length > 0 && (
          <p className="text-xs text-muted-foreground">
            The{" "}
            {templates.map((f, i) => (
              <span key={f.key}>
                {i > 0 && " and "}
                <a href={TEMPLATES[f.template!]} target="_blank" rel="noreferrer" className="underline">
                  {f.template} template
                </a>
              </span>
            ))}{" "}
            {templates.length > 1 ? "are" : "is"} added to the brief.
          </p>
        )}
      </div>

      {def.leadForm && (
        <div className="flex min-h-9 flex-wrap items-center gap-3">
          <p className="text-sm font-medium">Do you need lead form copy?</p>
          <div className="flex gap-1">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={needs.leadForm === v}
                onClick={() => set({ leadForm: v, leadFormQty: needs.leadFormQty || 1 })}
                className={cn("rounded-md border px-3 py-1 text-xs", needs.leadForm === v ? "border-primary bg-primary/10" : "hover:bg-secondary")}
              >
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
          {needs.leadForm && <Qty label="How many lead forms" value={needs.leadFormQty} onChange={(v) => set({ leadFormQty: v })} />}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="needs-notes">Notes</Label>
          <Textarea id="needs-notes" rows={3} value={needs.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anything else for the brief" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="needs-design">Notes for design</Label>
          <Textarea id="needs-design" rows={3} value={needs.designNotes} onChange={(e) => set({ designNotes: e.target.value })} placeholder="Sizes, style, references" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Empty notes are left out of Notion.</p>
    </div>
  )
}

function Qty({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(50, Math.max(1, v))
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <Button type="button" size="icon-sm" variant="outline" onClick={() => onChange(clamp(value - 1))} aria-label="One fewer">
        −
      </Button>
      <input
        type="number"
        min={1}
        max={50}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 1))}
        className="h-7 w-12 rounded-md border border-input bg-card text-center text-sm"
        aria-label={label}
      />
      <Button type="button" size="icon-sm" variant="outline" onClick={() => onChange(clamp(value + 1))} aria-label="One more">
        +
      </Button>
    </div>
  )
}

function Stepper({ step, onPick }: { step: number; onPick: (i: number) => void }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
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
            <span className={cn(i !== step && "hidden md:inline")}>{label}</span>
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
        <p className="text-xs text-muted-foreground">The full plan and what we need go in Description of Request, with a link back to the test.</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">The comment{tagged.length ? `, tagging ${tagged.join(", ")}` : ""}</p>
        {comment ? (
          <p className="max-h-56 overflow-y-auto rounded-md border p-3 text-sm break-words whitespace-pre-line">{highlight(comment, tagged)}</p>
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
