/**
 * A redirect target inside this app, or the fallback. Rejects anything a browser could read as
 * another site: "//evil.com", "/\evil.com", "/%5Cevil.com", schemes, and control characters.
 */
export function safePath(raw: unknown, fallback = "/"): string {
  const s = typeof raw === "string" ? raw : ""
  let decoded = s
  try {
    decoded = decodeURIComponent(s)
  } catch {
    return fallback
  }
  if (!s.startsWith("/") || s.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//") || s.length > 500) return fallback
  return s
}
