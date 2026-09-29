import { AppMark } from "@/components/brand"
import { ParticleAmpersand } from "@/components/fx/particle-ampersand"
import { Starfield } from "@/components/fx/starfield"
import { LoginForm } from "./login-form"

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new one.",
  domain: "Only Bordeaux & Burgundy accounts can sign in.",
  google: "Google sign-in didn't start. Try again, or use the email link.",
  denied: "Google sign-in was cancelled, or that account can't sign in here. Use your Bordeaux & Burgundy Google account.",
  setup: "Sign-in isn't set up on this server yet. Tell an admin.",
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams
  return (
    <main className="relative flex min-h-dvh items-center justify-center gap-16 overflow-hidden px-4">
      <Starfield count={110} />
      {/* Soft lime glow, echoing the website's hero */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-lime/10 blur-3xl" />
      <div className="relative w-full max-w-sm shrink-0 space-y-8">
        <AppMark />
        <div className="space-y-2">
          <h1 className="text-4xl leading-tight">
            Every client. <span className="text-lime">Every sprint.</span>
          </h1>
          <p className="text-sm text-muted-foreground">Paid media performance, weekly QA and test sprints, in one place.</p>
        </div>
        <div className="surface p-5">
          <LoginForm
            next={typeof next === "string" ? next : undefined}
            error={typeof error === "string" ? ERRORS[error] : undefined}
            // Shown once Google is set up in Supabase (GOOGLE_SIGNIN_ENABLED=true).
            google={process.env.GOOGLE_SIGNIN_ENABLED === "true"}
            // Email links are off until there's a proper email sender (Supabase's built-in one allows a
            // few an hour). EMAIL_SIGNIN_ENABLED=true brings them back.
            email={process.env.EMAIL_SIGNIN_ENABLED === "true" || process.env.GOOGLE_SIGNIN_ENABLED !== "true"}
          />
        </div>
      </div>
      <ParticleAmpersand className="hidden h-[480px] w-[420px] shrink-0 lg:block" />
    </main>
  )
}
