"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type State = { ok: boolean; message: string } | null

/** A form bound to a server action returning { ok, message }. */
export function AdminForm({
  action,
  children,
  submitLabel = "Save",
  className,
}: {
  action: (prev: State, form: FormData) => Promise<State>
  children: React.ReactNode
  submitLabel?: string
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, null)
  return (
    <form action={formAction} className={cn("space-y-3", className)}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {state && (
          <span className={cn("text-sm", state.ok ? "text-rag-green" : "text-rag-red")} role="status">
            {state.message}
          </span>
        )}
      </div>
    </form>
  )
}

export const fieldClass = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
