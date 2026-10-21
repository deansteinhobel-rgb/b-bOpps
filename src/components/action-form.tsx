"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createAction, type CreateActionState } from "@/lib/notion/actions"
import { cn } from "@/lib/utils"

/** id is the person's Notion user ID (null when unknown: they can't own an action). */
export type OwnerOption = { id: string | null; name: string; onTeam: boolean }

/**
 * Create an action in Notion. While testing (the default) the server only logs a dry run and
 * shows the exact page it would have created.
 */
export function ActionForm(props: {
  clientSlug: string
  owners: OwnerOption[]
  defaults: { title: string; ownerId: string | null; dueDate: string; description: string }
  checkResultId?: string
  live: boolean
  onDone?: () => void
}) {
  const [title, setTitle] = useState(props.defaults.title)
  const [ownerId, setOwnerId] = useState(props.defaults.ownerId ?? "")
  const [dueDate, setDueDate] = useState(props.defaults.dueDate)
  const [description, setDescription] = useState(props.defaults.description)
  const [state, setState] = useState<CreateActionState>({ status: "idle" })
  const [pending, start] = useTransition()
  const id = (s: string) => `${s}-${props.checkResultId ?? "new"}`

  const submit = () =>
    start(async () => {
      const res = await createAction({ clientSlug: props.clientSlug, title, ownerNotionId: ownerId, dueDate: dueDate || null, description, checkResultId: props.checkResultId ?? null })
      setState(res)
      if (res.status === "created") props.onDone?.()
    })

  if (state.status === "created") {
    return (
      <p className="text-sm text-rag-green" role="status">
        {state.message}{" "}
        <a href={state.url} target="_blank" rel="noreferrer" className="underline">
          Open in Notion
        </a>
      </p>
    )
  }

  return (
    <div className="space-y-3 rounded-md border bg-secondary/40 p-4">
      {!props.live && (
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Test mode.</strong> Notion writes are switched off, so this records what would be created and sends nothing to Notion.
        </p>
      )}
      <div className="space-y-1">
        <Label htmlFor={id("title")}>Title</Label>
        <Input id={id("title")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={id("owner")}>Owner (Project Lead)</Label>
          <select id={id("owner")} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm">
            <option value="">Pick an owner</option>
            {props.owners.map((o) => (
              <option key={o.id ?? o.name} value={o.id ?? ""} disabled={!o.id}>
                {o.name}
                {!o.id ? " (no Notion user)" : o.onTeam ? "" : " (not on this client)"}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("due")}>Due date</Label>
          <Input id={id("due")} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id("desc")}>Description</Label>
        <Textarea id={id("desc")} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Working…" : props.live ? "Create action in Notion" : "Test: preview the Notion action"}
        </Button>
        {state.status === "error" && (
          <span className="text-sm text-rag-red" role="alert">
            {state.message}
          </span>
        )}
      </div>
      {state.status === "dry_run" && <DryRunPreview message={state.message} payload={state.payload} />}
    </div>
  )
}

function DryRunPreview({ message, payload }: { message: string; payload: unknown }) {
  const props = (payload as { properties: Record<string, Record<string, unknown>> }).properties
  const show = (v: Record<string, unknown>): string => {
    if ("title" in v || "rich_text" in v) return ((v.title ?? v.rich_text) as { text: { content: string } }[]).map((t) => t.text.content).join("")
    if ("select" in v) return (v.select as { name: string }).name
    if ("status" in v) return (v.status as { name: string }).name
    if ("people" in v) return (v.people as { id: string }[]).map((p) => `Notion user ${p.id.slice(0, 8)}…`).join(", ")
    if ("date" in v) return (v.date as { start: string }).start
    if ("url" in v) return String(v.url)
    return JSON.stringify(v)
  }
  return (
    <div className={cn("rounded-md border border-dashed bg-card p-3 text-sm")} role="status">
      <p className="text-muted-foreground">{message}</p>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {Object.entries(props).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="break-words whitespace-pre-line">{show(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
