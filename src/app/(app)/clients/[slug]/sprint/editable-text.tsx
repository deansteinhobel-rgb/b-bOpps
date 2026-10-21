"use client"

import { useState, useTransition } from "react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { saveSprintText } from "./actions"

type Field = "goal" | "key_takeaway" | "highlights" | "challenges" | "progress_made"

/** A text box that saves when you click away. Read-only once the sprint is closed. */
export function EditableText(props: { sprintId: string; field: Field; initial: string | null; placeholder: string; rows?: number; readOnly: boolean; className?: string; label: string }) {
  const [value, setValue] = useState(props.initial ?? "")
  const [saved, setSaved] = useState(props.initial ?? "")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [, start] = useTransition()

  if (props.readOnly) {
    return <p className={cn("text-sm whitespace-pre-line", !value && "text-muted-foreground italic", props.className)}>{value || "Nothing recorded."}</p>
  }
  const save = () => {
    if (value === saved) return
    setStatus("saving")
    start(async () => {
      const r = await saveSprintText(props.sprintId, props.field, value)
      if (r.ok) {
        setSaved(value)
        setStatus("saved")
      } else setStatus("error")
    })
  }
  return (
    <div className="space-y-1">
      <Textarea aria-label={props.label} value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} rows={props.rows ?? 3} placeholder={props.placeholder} className={cn("bg-card", props.className)} />
      <p className="h-4 text-xs text-muted-foreground" role="status">
        {status === "saving" ? "Saving…" : status === "saved" && value === saved ? "Saved" : status === "error" ? <span className="text-rag-red">Couldn&apos;t save. Try again.</span> : value !== saved ? "Unsaved: click away to save" : ""}
      </p>
    </div>
  )
}
