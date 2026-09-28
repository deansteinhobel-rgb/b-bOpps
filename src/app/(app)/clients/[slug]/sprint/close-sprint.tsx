"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { closeSprint, reopenSprint } from "./actions"

export function CloseSprint({ sprintId, closed, isAdmin, carryCount }: { sprintId: string; closed: boolean; isAdmin: boolean; carryCount: number }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  if (closed) {
    return isAdmin ? (
      <Button variant="outline" disabled={pending} onClick={() => start(async () => void (await reopenSprint(sprintId)))}>
        Reopen sprint
      </Button>
    ) : null
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={pending}
        onClick={() => {
          if (!confirm(`Close this sprint? ${carryCount} item${carryCount === 1 ? "" : "s"} will carry into the next sprint. The review becomes read-only.`)) return
          start(async () => {
            const r = await closeSprint(sprintId)
            setMessage({ ok: r.ok, text: r.message ?? (r.ok ? "Closed." : "Couldn't close.") })
          })
        }}
      >
        {pending ? "Closing…" : "Close sprint and carry forward"}
      </Button>
      <span className="text-xs text-muted-foreground">{carryCount} item{carryCount === 1 ? "" : "s"} set to carry forward</span>
      {message && <span className={message.ok ? "text-sm text-rag-green" : "text-sm text-rag-red"}>{message.text}</span>}
    </div>
  )
}
