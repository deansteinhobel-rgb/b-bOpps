import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

export type AdKey = { platform: string; external_account_id: string; ad_id: string }
export type TextAd = { headlines: { text: string; pinned: string | null }[]; descriptions: { text: string; pinned: string | null }[]; path1: string | null; path2: string | null; finalUrl: string | null }
/** kind: what the ad is when there's no image (e.g. LinkedIn document ads, which Windsor has no thumbnail for). */
export type Preview = { src: string | null; link: string | null; textOnly: boolean; textAd?: TextAd | null; kind?: string | null }
export type PreviewMap = Record<string, Preview>

export const adKey = (a: AdKey) => `${a.platform}|${a.external_account_id}|${a.ad_id}`

const TEXT_ONLY_TYPES = new Set(["RESPONSIVE_SEARCH_AD", "EXPANDED_TEXT_AD", "TEXT_AD", "CALL_AD"])
const KIND: Record<string, string> = { NATIVE_DOCUMENT: "Document ad", VIDEO: "Video ad", CAROUSEL: "Carousel ad", DEMAND_GEN_MULTI_ASSET_AD: "Demand Gen ad", DEMAND_GEN_CAROUSEL_AD: "Demand Gen ad", DEMAND_GEN_VIDEO_RESPONSIVE_AD: "Video ad" }
const BUCKET = "ad-previews"

/**
 * Preview images for a set of ads, as signed URLs valid for an hour. Uses the caller's Supabase
 * client, so RLS (ad_creatives + storage policy) only returns their clients' creatives.
 */
export async function previewsFor(supabase: SupabaseClient, clientId: string, ads: AdKey[]): Promise<PreviewMap> {
  const ids = [...new Set(ads.map((a) => a.ad_id))]
  if (!ids.length) return {}
  const rows: { platform: string; external_account_id: string; ad_id: string; storage_path: string | null; preview_link: string | null; ad_type: string | null; text_ad: TextAd | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("ad_creatives")
      .select("platform, external_account_id, ad_id, storage_path, preview_link, ad_type, text_ad")
      .eq("client_id", clientId)
      .in("ad_id", ids.slice(i, i + 200))
    rows.push(...(data ?? []))
  }
  const paths = rows.map((r) => r.storage_path).filter(Boolean) as string[]
  const signed = new Map<string, string>()
  if (paths.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl)
  }
  const out: PreviewMap = {}
  for (const r of rows) {
    out[adKey(r)] = {
      src: r.storage_path ? (signed.get(r.storage_path) ?? null) : null,
      link: r.preview_link,
      textOnly: r.ad_type ? TEXT_ONLY_TYPES.has(r.ad_type) : false,
      textAd: r.text_ad,
      kind: r.ad_type ? (KIND[r.ad_type] ?? null) : null,
    }
  }
  return out
}
