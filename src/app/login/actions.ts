"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string }

const domain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "bordeauxandburgundy.co.uk").toLowerCase()

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(form.get("email"))
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." }
  const email = parsed.data
  if (!email.endsWith(`@${domain}`)) {
    return { status: "error", message: `Use your @${domain} email address.`, email }
  }

  // Only allow redirects back into this app.
  const nextRaw = String(form.get("next") ?? "/clients")
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/clients"
  const h = await headers()
  const origin = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
  })
  if (error) {
    const message = error.status === 429 ? "Too many sign-in emails. Wait a minute and try again." : "We couldn't send the email. Try again, or ask an admin."
    console.error("signInWithOtp failed", error.status, error.message)
    return { status: "error", message, email }
  }
  return { status: "sent", email }
}
