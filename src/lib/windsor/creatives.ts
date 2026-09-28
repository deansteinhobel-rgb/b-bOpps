import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Platform } from "./client"

/**
 * Ad previews. Windsor gives image URLs for Meta, LinkedIn and Google image/display ads (Google
 * search ads are text only). Meta and LinkedIn URLs expire after about a week, so the first time we
 * see an image we copy it into the private "ad-previews" bucket and keep our copy.
 */
const PREVIEW: Record<string, { id: string; images: string[]; link?: string; type?: string }> = {
  linkedin: { id: "creative_id", images: ["creative_thumbnail"] },
  facebook: { id: "ad_id", images: ["image_url", "thumbnail_url"], link: "ad_preview_shareable_link" },
  google_ads: { id: "ad_id", images: ["ad_image_ad_image_url", "ad_responsive_display_ad_marketing_images_1", "ad_multi_asset_ad_marketing_images_1"], type: "ad_type" },
}
export const BUCKET = "ad-previews"
const MAX_BYTES = 10 * 1024 * 1024
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }

type Account = { id: string; client_id: string; platform: Platform; windsor_connector: string; external_account_id: string }

async function fetchPreviews(account: Account, dateFrom: string, dateTo: string) {
  const cfg = PREVIEW[account.windsor_connector]
  if (!cfg) return []
  const fields = [cfg.id, ...cfg.images, ...(cfg.link ? [cfg.link] : []), ...(cfg.type ? [cfg.type] : [])]
  const params = new URLSearchParams({
    api_key: process.env.WINDSOR_API_KEY ?? "",
    date_from: dateFrom,
    date_to: dateTo,
    select_accounts: account.external_account_id,
    fields: fields.join(","),
  })
  const res = await fetch(`https://connectors.windsor.ai/${account.windsor_connector}?${params}`, { cache: "no-store" })
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>[]; error?: string } | null
  if (!res.ok || !Array.isArray(body?.data)) throw new Error(`Windsor previews ${account.windsor_connector}: HTTP ${res.status} ${body?.error ?? ""}`)
  const byAd = new Map<string, { ad_id: string; source_url: string | null; preview_link: string | null; ad_type: string | null }>()
  for (const r of body.data) {
    const adId = String(r[cfg.id] ?? "").trim()
    if (!adId) continue
    const img = cfg.images.map((f) => r[f]).find((v) => typeof v === "string" && v.startsWith("http")) as string | undefined
    const prev = byAd.get(adId)
    byAd.set(adId, {
      ad_id: adId,
      source_url: img ?? prev?.source_url ?? null,
      preview_link: (cfg.link && typeof r[cfg.link] === "string" ? (r[cfg.link] as string) : null) ?? prev?.preview_link ?? null,
      ad_type: (cfg.type && typeof r[cfg.type] === "string" ? (r[cfg.type] as string) : null) ?? prev?.ad_type ?? null,
    })
  }
  return [...byAd.values()]
}

/** Copies an image into our bucket. Returns the stored path and type, or throws. */
async function copyImage(url: string, path: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim()
  if (!EXT[type]) throw new Error(`Not a supported image (${type || "unknown type"})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) throw new Error("Image is over 10 MB")
  const fullPath = `${path}.${EXT[type]}`
  const { error } = await createAdminClient().storage.from(BUCKET).upload(fullPath, bytes, { contentType: type, upsert: true })
  if (error) throw new Error(error.message)
  return { storage_path: fullPath, content_type: type }
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

/**
 * Records preview links for ads seen in the date range, then copies up to `maxCopies` images we
 * don't hold yet. Reads Windsor; writes only our database and storage.
 */
export async function syncCreatives(opts: { clientId?: string; accountId?: string; dateFrom: string; dateTo: string; maxCopies?: number }) {
  const db = createAdminClient()
  let q = db.from("client_platform_accounts").select("id, client_id, platform, windsor_connector, external_account_id").eq("active", true)
  if (opts.clientId) q = q.eq("client_id", opts.clientId)
  if (opts.accountId) q = q.eq("id", opts.accountId)
  const { data: accounts, error } = await q
  if (error) throw new Error(error.message)

  const results: { account: string; ads: number; copied: number; failed: number; error?: string }[] = []
  let budget = opts.maxCopies ?? 200
  for (const account of (accounts ?? []) as Account[]) {
    const label = `${account.platform} ${account.external_account_id}`
    try {
      const previews = await fetchPreviews(account, opts.dateFrom, opts.dateTo)
      if (previews.length) {
        const now = new Date().toISOString()
        const { error: upErr } = await db.from("ad_creatives").upsert(
          previews.map((p) => ({ ...p, client_id: account.client_id, platform: account.platform, external_account_id: account.external_account_id, seen_at: now })),
          { onConflict: "platform,external_account_id,ad_id" },
        )
        if (upErr) throw new Error(upErr.message)
      }
      const { data: todo } = await db
        .from("ad_creatives")
        .select("id, ad_id, source_url")
        .eq("platform", account.platform)
        .eq("external_account_id", account.external_account_id)
        .is("storage_path", null)
        .is("copy_error", null)
        .not("source_url", "is", null)
        .limit(Math.max(budget, 0))
      let copied = 0
      let failed = 0
      for (const c of todo ?? []) {
        try {
          const stored = await copyImage(c.source_url!, `${account.client_id}/${account.platform}/${safe(c.ad_id)}`)
          await db.from("ad_creatives").update({ ...stored, copied_at: new Date().toISOString() }).eq("id", c.id)
          copied++
        } catch (e) {
          await db.from("ad_creatives").update({ copy_error: (e as Error).message.slice(0, 300) }).eq("id", c.id)
          failed++
        }
      }
      budget -= copied + failed
      results.push({ account: label, ads: previews.length, copied, failed })
    } catch (e) {
      results.push({ account: label, ads: 0, copied: 0, failed: 0, error: (e as Error).message })
    }
  }
  return results
}
