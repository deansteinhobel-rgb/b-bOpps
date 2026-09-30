import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

// "/design" is a development-only preview with sample data (it 404s in production).
const PUBLIC_PATHS = ["/login", "/auth/", ...(process.env.NODE_ENV === "development" ? ["/design"] : [])]
// Scheduled jobs have no session: they check `Authorization: Bearer $CRON_SECRET` themselves.
const CRON_PREFIX = "/api/cron/"
// View-only report links for Notion embeds (Dean, 2026-09-29): no session; the secret token in the
// URL is the key. Only Notion may frame them.
const EMBED_PREFIX = "/embed/"
const NOTION_FRAME_ANCESTORS = "https://notion.so https://www.notion.so https://*.notion.so https://*.notion.site"

/**
 * Content-Security-Policy (security review, 2026-09-29): scripts only from this app with a fresh
 * nonce per request (Next adds it to its own scripts), no framing (clickjacking), no plugins, forms
 * post back here only. Images, uploads and storage are allowed from our Supabase project, and
 * favicons (source chips) from Google. Inline style attributes are allowed: the UI sets widths and
 * colors inline, and styles can't run code.
 */
function contentSecurityPolicy(nonce: string, frameAncestors = "'none'") {
  const dev = process.env.NODE_ENV === "development"
  const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin
  // Cloudflare Turnstile on the login page, once switched on.
  const turnstile = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? " https://challenges.cloudflare.com" : ""
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${turnstile}${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabase} https://www.google.com https://*.gstatic.com`,
    `media-src 'self' blob: ${supabase}`,
    `font-src 'self' data:`,
    `connect-src 'self' ${supabase} ${supabase.replace(/^https/, "wss")}${turnstile}${dev ? " ws:" : ""}`,
    `worker-src 'self' blob:`,
    turnstile ? `frame-src${turnstile}` : `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors ${frameAncestors}`,
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ")
}

/** Refreshes the Supabase session cookie, sends signed-out visitors to /login, and sets the CSP. */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (path.startsWith(CRON_PREFIX)) return NextResponse.next()

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const embed = path.startsWith(EMBED_PREFIX)
  const csp = contentSecurityPolicy(nonce, embed ? NOTION_FRAME_ANCESTORS : undefined)
  // Next reads the nonce from the request's CSP header when it renders the page.
  const next = () => {
    const headers = new Headers(request.headers)
    headers.set("x-nonce", nonce)
    headers.set("content-security-policy", csp)
    return NextResponse.next({ request: { headers } })
  }
  // Embeds skip the session entirely: no sign-in, and no cookies read or set.
  if (embed) {
    const response = next()
    response.headers.set("Content-Security-Policy", csp)
    return response
  }
  let response = next()

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value)
        response = next()
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options)
      },
    },
  })

  // getClaims() validates the JWT and refreshes the session when needed. Don't run code between
  // creating the client and this call.
  const { data } = await supabase.auth.getClaims()
  const signedIn = Boolean(data?.claims)
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`
    return NextResponse.redirect(url)
  }
  if (signedIn && path === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/clients"
    url.search = ""
    return NextResponse.redirect(url)
  }
  response.headers.set("Content-Security-Policy", csp)
  return response
}

export const config = {
  // Everything except static files and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
}
