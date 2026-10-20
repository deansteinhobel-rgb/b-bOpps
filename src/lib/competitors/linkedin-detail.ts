import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchFrom, readBytes } from "@/lib/windsor/creatives"
import { isMessageAd, parseMessageAd } from "./linkedin-message"

/**
 * Message and conversation ads' text, read from their public LinkedIn Ad Library page (Dean,
 * 2026-10-20; the scraper returns none, and this costs no Apify credit). LinkedIn answers a cold
 * request with 403 but sets a guest cookie; a request with it gets the page. Its bot check lets one
 * page through per guest cookie, so each ad gets a fresh one (tested 2026-10-20). Only
 * linkedin.com, through fetchFrom, a few ads a pass and a pause between them. Writes the copy
 * columns of competitor_ads and keyword_ads only; LinkedIn is only read.
 */
const HOSTS = ["linkedin.com"]
const HEADERS = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "accept-language": "en-US", accept: "text/html" }
/** Ads read per pass, and the pause between them, to stay polite. */
const PER_PASS = 15
const PAUSE_MS = 2500

async function guestCookies() {
  const res = await fetchFrom(HOSTS, "https://www.linkedin.com/ad-library/home", { headers: HEADERS, signal: AbortSignal.timeout(15_000), cache: "no-store" })
  await res.body?.cancel().catch(() => {})
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
}

async function detailPage(adId: string, cookie: string) {
  if (!/^\d+$/.test(adId)) throw new Error("Bad ad id")
  const res = await fetchFrom(HOSTS, `https://www.linkedin.com/ad-library/detail/${adId}`, {
    headers: { ...HEADERS, cookie, referer: "https://www.linkedin.com/ad-library/home" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`LinkedIn HTTP ${res.status}`)
  return new TextDecoder().decode(await readBytes(res, 2_000_000, "Ad page is too large"))
}

/**
 * Fills in message and conversation ads with no text yet, up to PER_PASS across both tables. One
 * that can't be read gets an empty copy, so it isn't tried again until its next read.
 */
export async function fillMessageAds(scope: string[], stopAt: number) {
  const db = createAdminClient()
  const todo: { table: "competitor_ads" | "keyword_ads"; id: string; external_id: string; format: string | null; landing_url: string | null }[] = []
  for (const table of ["competitor_ads", "keyword_ads"] as const) {
    const { data } = await db
      .from(table)
      .select("id, external_id, format, landing_url")
      .in("client_id", scope)
      .eq("source", "linkedin")
      .is("body", null)
      .or("format.ilike.%inmail%,format.ilike.%message%,format.ilike.%conversation%")
      .order("last_seen_at", { ascending: false })
      .limit(PER_PASS)
    todo.push(...(data ?? []).filter((a) => isMessageAd(a.format)).map((a) => ({ ...a, table })))
  }
  if (!todo.length) return 0
  let filled = 0
  for (const ad of todo.slice(0, PER_PASS)) {
    if (Date.now() > stopAt) break
    try {
      const msg = parseMessageAd(await detailPage(ad.external_id, await guestCookies()))
      if (!msg) throw new Error("No message on the page")
      await db
        .from(ad.table)
        .update({ headline: msg.sender ? `Message from ${msg.sender}` : null, body: msg.body, cta: msg.ctas.join(" / ") || null, landing_url: ad.landing_url ?? msg.landing_url })
        .eq("id", ad.id)
      filled++
    } catch {
      await db.from(ad.table).update({ body: "" }).eq("id", ad.id)
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS))
  }
  return filled
}
