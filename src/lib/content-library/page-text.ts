/**
 * Turns a client's web page into the text Claude reads when someone adds it to the content library
 * ("Read page"). Plain module, no fetching (that's read-page.ts), so it can be tested.
 */

export type PageText = { title: string; description: string; canonicalUrl: string | null; text: string; words: number }

const MAX_TEXT = 15_000

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" }
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim()
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))
const attrValue = (tag: string, name: string) => {
  const m = attr(tag, name)
  return m ? (m[2] ?? m[3] ?? "") : null
}

function meta(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attrValue(tag, "property") ?? attrValue(tag, "name") ?? "").toLowerCase()
    if (keys.includes(key)) {
      const v = attrValue(tag, "content")
      if (v) return clean(v)
    }
  }
  return ""
}

/**
 * Title, description, canonical link and readable text of a page. Scripts, styles, navigation,
 * headers, footers and forms are dropped; the main content is preferred when the page marks it.
 * The canonical link is only kept when it stays on one of `hosts`.
 */
export function pageFromHtml(html: string, hosts: readonly string[] = []): PageText {
  const title = clean(meta(html, ["og:title"]) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") || "")
  const description = meta(html, ["description", "og:description", "twitter:description"])

  let canonicalUrl: string | null = null
  const link = (html.match(/<link\b[^>]*>/gi) ?? []).find((t) => (attrValue(t, "rel") ?? "").toLowerCase() === "canonical")
  const href = link ? attrValue(link, "href") : null
  if (href) {
    try {
      const u = new URL(decodeEntities(href))
      if (u.protocol === "https:" && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) canonicalUrl = u.toString()
    } catch {
      // Not a URL: leave it out.
    }
  }

  let body = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html
  body = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|header|footer|form|button|select)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v\r]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT)
  return { title, description, canonicalUrl, text, words: text ? text.split(/\s+/).length : 0 }
}

const TOO_LARGE = "The page is too large to read. Paste the page text instead."

/**
 * The response body as text, stopping as soon as it passes `max` bytes (Aikido, PR #10): a huge page
 * is refused while it streams in, never buffered whole.
 */
export async function readCapped(res: Response, max: number): Promise<string> {
  const length = Number(res.headers.get("content-length"))
  if (Number.isFinite(length) && length > max) {
    // Release the connection: an unread body would hold it open.
    await res.body?.cancel().catch(() => {})
    throw new Error(TOO_LARGE)
  }
  if (!res.body) throw new Error("The page didn't respond. Try again, or paste the page text.")
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw new Error(TOO_LARGE)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(bytes)
}
