import type { NextConfig } from "next"

/**
 * Security headers on every response (security review, 2026-09-29). The Content-Security-Policy is
 * set per request in src/proxy.ts, because it carries a fresh nonce.
 */
const commonHeaders = [
  // HTTPS only, for two years, including subdomains (Vercel serves HTTPS).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Browsers must not guess file types (stops uploaded files being run as scripts).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Links to other sites get the origin only, never our paths (they carry client slugs).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Features the app never uses stay off.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  // Pop-ups we open can't reach back into the app.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
]
// No framing by other sites (clickjacking); the CSP says the same with frame-ancestors.
const securityHeaders = [...commonHeaders, { key: "X-Frame-Options", value: "DENY" }]
// Report embeds (/embed/*) may be framed by Notion only (the CSP's frame-ancestors in src/proxy.ts;
// X-Frame-Options can't name a site, so it's left off there). Never indexed, never send a referrer.
const embedHeaders = [
  ...commonHeaders.filter((h) => h.key !== "Referrer-Policy"),
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
]

const nextConfig: NextConfig = {
  // Don't advertise the framework.
  poweredByHeader: false,
  // Old client tab URLs (Dean, 2026-09-29): Account became "At a glance" (the client's home), and
  // Overview + Performance became Reporting.
  async redirects() {
    return [
      { source: "/clients/:slug/account", destination: "/clients/:slug", permanent: false },
      { source: "/clients/:slug/performance", destination: "/clients/:slug/reporting", permanent: false },
      { source: "/clients/:slug/performance/:path*", destination: "/clients/:slug/reporting/:path*", permanent: false },
    ]
  },
  async headers() {
    return [
      { source: "/((?!embed/).*)", headers: securityHeaders },
      { source: "/embed/:path*", headers: embedHeaders },
    ]
  },
}

export default nextConfig
