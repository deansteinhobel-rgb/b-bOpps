import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

export type AdKey = { platform: string; external_account_id: string; ad_id: string }
export type Preview = { src: string | null; link: string | null; textOnly: boolean }
export type PreviewMap = Record<string, Preview>

export const adKey = (a: AdKey) => `${a.platform}|${a.external_account_id}|${a.ad_id}`

const TEXT_ONLY_TYPES = new Set(["RESPONSIVE_SEARCH_AD", "EXPANDED_TEXT_AD", "TEXT_AD", "CALL_AD"])
const BUCKET = "ad-previews"

/**
 * Preview images for a set of ads, as signed URLs valid for an hour. Uses the caller's Supabase
 * client, so RLS (ad_creatives + storage policy) only returns their clients' creatives.
 */
export async function previewsFor(supabase: SupabaseClient, clientId: string, ads: AdKey[]): Promise<PreviewMap> {
  const ids = [...new Set(ads.map((a) => a.ad_id))]
  if (!ids.length) return {}
  const rows: { platform: string; external_account_id: string; ad_id: string; storage_path: string | null; preview_link: string | null; ad_type: string | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("ad_creatives")
      .select("platform, external_account_id, ad_id, storage_path, preview_link, ad_type")
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
    }
  }
  return out
}
