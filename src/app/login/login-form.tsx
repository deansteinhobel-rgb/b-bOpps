"use client"

import Script from "next/script"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Sparkle } from "@/components/fx/sparkle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sendMagicLink, signInWithGoogle, type LoginState } from "./actions"

// Bot protection on sign-in, when switched on (docs/security.md). The site key is public by design.
const TURNSTILE = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

export function LoginForm({ next, error, google, email = true }: { next?: string; error?: string; google?: boolean; email?: boolean }) {
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
    <div className="space-y-5">
      {google && (
        <>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next ?? "/"} />
            <GoogleButton />
          </form>
          {email && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              or get a link by email
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          {!email && state.status === "error" && state.message && (
            <p className="text-sm text-rag-red" role="alert">
              {state.message}
            </p>
          )}
          {!email && <p className="text-center text-xs text-muted-foreground">Use your Bordeaux &amp; Burgundy Google account.</p>}
        </>
      )}
    {email && (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/"} />
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        {/* key: remount with the submitted email after an error, instead of changing defaultValue */}
        <Input key={state.email ?? ""} id="email" name="email" type="email" autoComplete="email" required placeholder="name@bordeauxandburgundy.co.uk" defaultValue={state.email} />
      </div>
      {TURNSTILE && (
        <>
          {/* Cloudflare Turnstile: adds a hidden cf-turnstile-response field to the form. */}
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
          <div className="cf-turnstile" data-sitekey={TURNSTILE} data-theme="dark" />
        </>
      )}
      {state.status === "error" && (
        <p className="text-sm text-rag-red" role="alert">
          {state.message}
        </p>
      )}
      <Sparkle className="w-full">
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </Sparkle>
    </form>
    )}
    </div>
  )
}

function GoogleButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" className="h-10 w-full gap-2.5 font-medium" disabled={pending}>
      <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {pending ? "Opening Google…" : "Continue with Google"}
    </Button>
  )
}
