import { type EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Where the magic link lands. Handles both link styles Supabase can send:
 * `?code=` (default template, PKCE) and `?token_hash=&type=` (custom template).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const nextRaw = searchParams.get("next") ?? "/clients"
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/clients"

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
