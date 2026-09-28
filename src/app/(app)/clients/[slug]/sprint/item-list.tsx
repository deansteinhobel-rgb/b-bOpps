"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ItemKind, SprintItem } from "@/lib/sprints/data"
import { cn } from "@/lib/utils"
import { addItem, updateItem } from "./actions"

const ORIGIN: Record<ItemKind, string> = { hypothesis: "Hypothesis", learning: "Learning", mitigation: "Mitigation", action: "Action", carried: "Carried" }
const OUTCOMES = [
  { value: "proven", label: "Proven", cls: "bg-rag-green-bg text-rag-green" },
  { value: "disproven", label: "Disproven", cls: "bg-rag-red-bg text-rag-red" },
  { value: "inconclusive", label: "Inconclusive", cls: "bg-rag-na-bg text-rag-na" },
] as const

/**
 * A list of sprint items of one kind. Items can be ticked done, dropped (never deleted), marked
 * proven/disproven (hypotheses), and chosen to carry into the next sprint.
 */
export function ItemList(props: {
  sprintId: string
  kind: ItemKind
  items: SprintItem[]
  readOnly: boolean
  addPlaceholder?: string
  showCarry?: boolean
  emptyText: string
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const visible = props.items.filter((i) => i.status !== "dropped")

  const add = () =>
    start(async () => {
      const r = await addItem(props.sprintId, props.kind as "hypothesis" | "learning" | "mitigation" | "action", text)
      if (r.ok) {
        setText("")
        setError(null)
      } else setError(r.message ?? "Couldn't add it.")
    })
  const patch = (id: string, p: Parameters<typeof updateItem>[1]) => start(async () => void (await updateItem(id, p)))

  return (
    <div className="space-y-2 text-sm">
      {visible.length === 0 && <p className="text-muted-foreground italic">{props.emptyText}</p>}
      <ul className="space-y-2">
        {visible.map((i) => (
          <li key={i.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={i.status === "done"}
              disabled={props.readOnly || pending}
              onChange={(e) => patch(i.id, { status: e.target.checked ? "done" : "open" })}
              aria-label={`Mark "${i.text}" done`}
            />
            <div className="min-w-0 flex-1">
              <p className={cn("whitespace-pre-line", i.status === "done" && "text-muted-foreground line-through")}>{i.text}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {i.kind === "carried" && i.origin_kind && (
                  <span className="text-muted-foreground">
                    {ORIGIN[i.origin_kind]} from Sprint {i.origin_sprint_number}
                  </span>
                )}
                {(i.kind === "hypothesis" || i.origin_kind === "hypothesis") &&
                  OUTCOMES.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      disabled={props.readOnly || pending}
                      onClick={() => patch(i.id, { outcome: i.outcome === o.value ? null : o.value })}
                      className={cn("rounded-full border px-2 py-0.5", i.outcome === o.value ? o.cls : "text-muted-foreground hover:bg-secondary")}
                      aria-pressed={i.outcome === o.value}
                    >
                      {o.label}
                    </button>
                  ))}
                {props.showCarry && !props.readOnly && (
                  <label className="flex items-center gap-1 text-muted-foreground">
                    <input type="checkbox" checked={i.carry_forward} disabled={pending} onChange={(e) => patch(i.id, { carry_forward: e.target.checked })} />
                    Carry into next sprint
                  </label>
                )}
                {props.showCarry && props.readOnly && i.carry_forward && <span className="text-muted-foreground">Carried forward</span>}
                {!props.readOnly && (
                  <button type="button" className="text-muted-foreground underline hover:text-rag-red" disabled={pending} onClick={() => patch(i.id, { status: "dropped" })}>
                    Drop
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!props.readOnly && props.kind !== "carried" && (
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && text.trim() && add()}
            placeholder={props.addPlaceholder}
            className="bg-card"
            aria-label={props.addPlaceholder}
          />
          <Button type="button" variant="outline" onClick={add} disabled={pending || !text.trim()}>
            Add
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-rag-red">{error}</p>}
    </div>
  )
}
