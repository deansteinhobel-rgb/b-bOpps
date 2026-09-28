"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sendMagicLink, type LoginState } from "./actions"

export function LoginForm({ next, error }: { next?: string; error?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {
    status: error ? "error" : "idle",
    message: error,
  })

  if (state.status === "sent") {
    return (
      <div className="space-y-2" role="status">
        <h2 className="text-2xl">Check your email</h2>
        <p className="text-muted-foreground">
          We sent a sign-in link to <strong className="text-foreground">{state.email}</strong>. Open it in this browser. It works once and expires after an hour.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/clients"} />
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="name@bordeauxandburgundy.co.uk" defaultValue={state.email} />
      </div>
      {state.status === "error" && (
        <p className="text-sm text-rag-red" role="alert">
          {state.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  )
}
