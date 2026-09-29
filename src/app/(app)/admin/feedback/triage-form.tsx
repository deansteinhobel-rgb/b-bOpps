"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { fieldClass } from "@/components/field-class"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FEEDBACK_STATUS } from "@/lib/feedback"
import { triageFeedback } from "../../options/actions"

type Status = "new" | "planned" | "in_progress" | "done" | "wont_do"

export function TriageForm({ id, status, note }: { id: string; status: string; note: string }) {
  const [s, setS] = useState(status as Status)
  const [n, setN] = useState(note)
  const [pending, start] = useTransition()
  const dirty = s !== status || n !== note
  return (
    <div className="flex flex-col gap-2">
      <select className={fieldClass} value={s} onChange={(e) => setS(e.target.value as Status)} aria-label="Status">
        {Object.entries(FEEDBACK_STATUS).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </select>
      <Input value={n} onChange={(e) => setN(e.target.value)} placeholder="Reply to the sender (optional)" />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !dirty}
        onClick={() =>
          start(async () => {
            const r = await triageFeedback(id, { status: s, admin_note: n })
            if (r.ok) toast.success("Saved.")
            else toast.error(r.message ?? "Couldn't save.")
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  )
}
