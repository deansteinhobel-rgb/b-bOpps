import { type EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"
import { safePath } from "@/lib/safe-path"
import { createClient } from "@/lib/supabase/server"

/**
 * Where the magic link lands. Handles both link styles Supabase can send:
 * `?code=` (default template, PKCE) and `?token_hash=&type=` (custom template).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const next = safePath(searchParams.get("next") ?? "/", "/") // "/" opens the start page from Options

  // Google sign-in canceled or refused (e.g. an account outside the company, blocked on sign-up).
  if (searchParams.get("error")) {
    // Values from the URL are logged as JSON, so line breaks can't forge log lines (Aikido, log injection).
    console.error("auth confirm: provider error", JSON.stringify({ error: searchParams.get("error")?.slice(0, 100), description: searchParams.get("error_description")?.slice(0, 300) }))
    return NextResponse.redirect(`${origin}/login?error=denied`)
  }
  const supabase = await createClient()
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("missing code") }

  if (error) {
    console.error("auth confirm failed", error.message)
    return NextResponse.redirect(`${origin}/login?error=link`)
  }
  return NextResponse.redirect(`${origin}${next}`)
}
