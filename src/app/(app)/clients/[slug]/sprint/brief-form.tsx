"use client"

import { useEffect, useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { Sparkle } from "@/components/fx/sparkle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { briefOptions, briefTest, type BriefOptions, type BriefPerson } from "./test-actions"

const PRIORITY_OPTIONS = ["High", "Medium", "Low"] as const

/**
 * "Brief the team": the Notion row's project leads, due date and priority, plus the first comment
 * with the people to tag. Nothing is sent until the button at the bottom, and only then if live
 * writes are on for this client.
 */
export function BriefForm(props: { testId: string; onCancel: () => void; onDone: (r: { ok: boolean; text: string; preview?: { properties: Record<string, unknown>; comment?: string; people: BriefPerson[] } }) => void }) {
  const [opts, setOpts] = useState<BriefOptions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [leadIds, setLeadIds] = useState<string[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState("")
  const [priority, setPriority] = useState<(typeof PRIORITY_OPTIONS)[number]>("Medium")
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    let alive = true
    briefOptions(props.testId).then((r) => {
      if (!alive) return
      if (!r.ok) return setLoadError(r.message)
      setOpts(r.options)
      setLeadIds(r.options.leadIds)
      setDueDate(r.options.dueDate ?? "")
      setPriority(r.options.priority)
      setComment(r.options.comment)
    })
    return () => {
      alive = false
    }
  }, [props.testId])

  if (loadError) return <p className="text-xs text-rag-red">{loadError}</p>
  if (!opts) return <p className="text-xs text-muted-foreground">Loading the Notion people…</p>

  const name = (id: string) => opts.people.find((p) => p.id === id)?.name ?? "Unknown"
  const tagged = tagIds.map(name)

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">Master Production row</p>
        <p className="font-semibold">{opts.title}</p>
        <p className="text-xs text-muted-foreground">Master Status New · Production Type Paid Media · Status Content Ready for Copy</p>
      </div>

      <PeoplePicker label="Project lead" people={opts.people} value={leadIds} onChange={setLeadIds} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`due-${props.testId}`}>Due date</Label>
          <Input id={`due-${props.testId}`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`prio-${props.testId}`}>Priority</Label>
          <select id={`prio-${props.testId}`} className={fieldClass} value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITY_OPTIONS)[number])}>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      <PeoplePicker label="Tag in the comment" people={opts.people} value={tagIds} onChange={setTagIds} hint="They get a Notion notification." />
      <div className="space-y-1">
        <Label htmlFor={`comment-${props.testId}`}>Comment</Label>
        <Textarea id={`comment-${props.testId}`} rows={12} value={comment} onChange={(e) => setComment(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          {tagged.length
            ? `Starts with "Hey ${tagged.map((n) => `@${n}`).join(", ")}" unless you name them yourself (write @ and their full name).`
            : "Leave it empty to skip the comment."}
        </p>
      </div>

      {error && <p className="text-xs text-rag-red">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Sparkle>
          <Button
            size="sm"
            disabled={pending || !leadIds.length || !dueDate}
            onClick={() =>
              start(async () => {
                setError(null)
                const r = await briefTest(props.testId, { leadIds, dueDate, priority, tagIds, comment })
                if (!r.ok && !r.url) return setError(r.message ?? "Couldn't brief.")
                props.onDone({
                  ok: r.ok,
                  text: r.message ?? "Done",
                  preview: r.dryRun ? { properties: (r.payload as { properties: Record<string, unknown> }).properties, comment: r.comment, people: opts.people } : undefined,
                })
              })
            }
          >
            {pending ? "Working…" : opts.live ? "Create in Notion" : "Test: preview the Notion brief"}
          </Button>
        </Sparkle>
        <Button size="sm" variant="ghost" disabled={pending} onClick={props.onCancel}>
          Cancel
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
    <div className="space-y-1">
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
    </div>
  )
}
