/**
 * Development only: sign in on http://localhost:3000 without an email (Supabase's built-in sender
 * allows only a few magic links an hour). Makes a one-time sign-in link for an existing account with
 * the admin API and opens it in your default browser. The link works once and expires within an hour.
 *
 *   pnpm dev:signin you@bordeauxandburgundy.co.uk
 *
 * Refuses unless APP_URL is localhost, and only for accounts that already signed in once (existing
 * users). Never print the link: it's as good as a password until it's used.
 */
import { execFile } from "node:child_process"
import { createClient } from "@supabase/supabase-js"

const email = (process.argv[2] ?? "").trim().toLowerCase()
const appUrl = process.env.APP_URL ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(appUrl.replace(/\/$/, ""))) {
  console.error(`Refusing: APP_URL is "${appUrl}", not localhost. This script is for local development only.`)
  process.exit(1)
}
if (!email.endsWith(`@${process.env.ALLOWED_EMAIL_DOMAIN ?? "bordeauxandburgundy.co.uk"}`)) {
  console.error("Give your work email: pnpm dev:signin you@bordeauxandburgundy.co.uk")
  process.exit(1)
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const { data: profile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle()
if (!profile) {
  console.error(`No account for ${email} yet. Sign in once with a magic link first.`)
  process.exit(1)
}
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email })
if (error || !data.properties?.hashed_token) {
  console.error(`Couldn't make a sign-in link: ${error?.message ?? "no token"}`)
  process.exit(1)
}
// Our /auth/confirm route verifies the token and sets the session cookie for localhost.
const link = `${appUrl.replace(/\/$/, "")}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink&next=%2F`
const opener = process.platform === "win32" ? ["cmd", ["/c", "start", '""', link.replace(/&/g, "^&")]] : process.platform === "darwin" ? ["open", [link]] : ["xdg-open", [link]]
execFile(opener[0] as string, opener[1] as string[], (e) => {
  if (e) console.error("Couldn't open the browser. Run it again, or open localhost and sign in by email once the limit resets.")
  else console.log(`Opened a one-time sign-in link for ${email} on ${appUrl}.`)
})
