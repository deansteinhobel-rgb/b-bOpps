"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { refreshFromNotion } from "@/lib/notion/actions"

/** "Synced X minutes ago" plus the manual refresh. The label is computed on the server. */
export function NotionSyncBar({ clientSlug, syncedLabel }: { clientSlug: string; syncedLabel: string }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <span>From Notion · synced {syncedLabel}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshFromNotion(clientSlug)
            setMessage(r.message)
          })
        }
      >
        {pending ? "Refreshing…" : "Refresh from Notion"}
      </Button>
      {message && <span role="status">{message}</span>}
    </div>
  )
}
