"use client"

import { useTransition } from "react"
import { removeTeamMember } from "../../actions"

export function RemoveMember({ clientId, email, role, name }: { clientId: string; email: string; role: string; name: string }) {
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-muted-foreground underline hover:text-rag-red"
      onClick={() => {
        if (confirm(`Remove ${name} from this client's team? Their history is kept.`)) start(() => removeTeamMember(clientId, email, role).then(() => undefined))
      }}
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  )
}
