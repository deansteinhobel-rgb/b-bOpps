"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { safePath } from "@/lib/safe-path"
import { createClient } from "@/lib/supabase/server"

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string }

const domain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "bordeauxandburgundy.co.uk").toLowerCase()

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  // Hidden on the login page while Google is the way in (see page.tsx); refuse direct posts too.
  if (process.env.GOOGLE_SIGNIN_ENABLED === "true" && process.env.EMAIL_SIGNIN_ENABLED !== "true") {
    return { status: "error", message: "Sign in with your Bordeaux & Burgundy Google account." }
  }
  const parsed = z.string().trim().toLowerCase().email().safeParse(form.get("email"))
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." }
  const email = parsed.data
  if (!email.endsWith(`@${domain}`)) {
    return { status: "error", message: `Use your @${domain} email address.`, email }
  }

  // Only allow redirects back into this app.
  const next = safePath(form.get("next"), "/")
  // The magic link must point at our own domain. In production that's APP_URL only: the Host header
  // can be forged. (Supabase's redirect allow-list is the second line of defence.)
  const h = await headers()
  const origin = process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? null : `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`)
  if (!origin) {
    console.error("APP_URL isn't set: refusing to build a sign-in link from the Host header")
    return { status: "error", message: "Sign-in isn't set up on this server yet. Tell an admin.", email }
  }

  // Bot protection: when Turnstile is switched on (site key set here, CAPTCHA on in Supabase Auth),
  // the widget's token goes with the request and Supabase checks it.
  const captchaToken = String(form.get("cf-turnstile-response") ?? "") || undefined
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) return { status: "error", message: "Please complete the check below the email box.", email }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`, captchaToken },
  })
  if (error) {
    const message = error.status === 429 ? "Too many sign-in emails. Wait a minute and try again." : "We couldn't send the email. Try again, or ask an admin."
    console.error("signInWithOtp failed", error.status, error.message)
    return { status: "error", message, email }
  }
  return { status: "sent", email }
}

/**
 * "Continue with Google" (Dean, 2026-09-29): free, no emails, so no sending limits. Google only offers
 * Bordeaux & Burgundy accounts (`hd`), and the database still refuses any other domain on sign-up.
 * Supabase sends people to Google and back to /auth/confirm, which finishes the sign-in (?code=).
 */
export async function signInWithGoogle(form: FormData) {
  const next = safePath(form.get("next"), "/")
  const h = await headers()
  const origin = process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? null : `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`)
  if (!origin) redirect("/login?error=setup")
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      queryParams: { hd: domain, prompt: "select_account" },
    },
  })
  if (error || !data.url) {
    console.error("Google sign-in failed to start", error?.message)
    redirect("/login?error=google")
  }
  redirect(data.url)
}
