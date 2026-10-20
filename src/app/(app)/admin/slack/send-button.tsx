"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { sendSnapshotNow } from "./actions"

export function SendNowButton({ clientId, channel }: { clientId: string; channel: string | null }) {
  const [pending, start] = useTransition()
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="white"
        disabled={pending || !channel}
        onClick={() => {
          if (!confirm(`Post this snapshot to Slack (${channel}) now?`)) return
          start(async () => setNote(await sendSnapshotNow(clientId)))
        }}
      >
        {pending ? "Sending…" : "Send a test to Slack"}
      </Button>
      {note && <span className={note.ok ? "text-sm text-rag-green" : "text-sm text-rag-red"}>{note.message}</span>}
    </div>
  )
}
