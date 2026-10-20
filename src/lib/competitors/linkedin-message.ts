/**
 * LinkedIn message and conversation ads (Dean, 2026-10-20): the Ad Library scraper returns no text
 * for them, but the ad's public detail page shows the whole message: who it's from, the message
 * and its buttons (several for a conversation ad). This reads that page's HTML. A plain module (tested).
 */
import { cut } from "./sources"

/** Formats whose text only the detail page has. */
export const isMessageAd = (format: string | null) => !!format && /inmail|message|conversation/i.test(format)

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " }
const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
const text = (html: string) => decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim()

export type MessageAd = { sender: string | null; body: string; ctas: string[]; landing_url: string | null }

/** The message on a LinkedIn Ad Library detail page, or null when the page has none (a sign-in wall, another ad type). */
export function parseMessageAd(html: string): MessageAd | null {
  const start = html.indexOf("sponsored-message__content")
  if (start < 0) return null
  const open = html.indexOf(">", start) + 1
  const endMarker = html.indexOf("sponsored-message__truncation-button", open)
  const end = endMarker > 0 ? html.lastIndexOf("<button", endMarker) : html.indexOf("</div>", open)
  const block = html.slice(open, end > open ? end : undefined)
  // One <p> per line in LinkedIn's editor; empty ones are blank lines.
  const lines = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => text(m[1]))
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  if (!body) return null
  // The sender's name is the bold line just before the message.
  const before = html.slice(Math.max(0, start - 600), start)
  const sender = [...before.matchAll(/<p class="font-semibold[^"]*">([\s\S]*?)<\/p>/gi)].map((m) => text(m[1])).pop() || null
  // Buttons follow the message: one for a message ad, several choices for a conversation ad.
  const after = html.slice(end, end + 6000)
  const ctas = [...after.matchAll(/<button class="btn-[^"]*"[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => text(m[1])).filter((t) => t && t.length <= 80)
  const href = block.match(/<a[^>]+href="(https:\/\/[^"]+)"/i)?.[1]
  let landing: string | null = null
  if (href) {
    try {
      const u = new URL(decode(href))
      landing = `${u.origin}${u.pathname}`
    } catch {
      landing = null
    }
  }
  return { sender: sender ? cut(sender, 120) : null, body: cut(body, 4000), ctas: [...new Set(ctas)].slice(0, 6), landing_url: landing }
}
