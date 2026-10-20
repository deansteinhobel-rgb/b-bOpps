/**
 * Competitor ads: the three public ad libraries we read through Apify, one pinned actor each (picked
 * in a trial on DNSFilter's competitors, 2026-10-20), what to send it and how to read what comes
 * back. A plain module, so the normalizers can be tested. Nothing here writes anywhere.
 */

export const COMPETITOR_SOURCES = ["meta", "google", "linkedin"] as const
export type CompetitorSource = (typeof COMPETITOR_SOURCES)[number]

export const SOURCE_LABEL: Record<CompetitorSource, string> = { meta: "Meta", google: "Google Ads", linkedin: "LinkedIn" }
/** Countries every competitor is read in (Dean, 2026-10-20). */
export const COUNTRIES = ["US", "GB"] as const
/** Most ads kept per competitor, source and country in one weekly run. */
export const MAX_ADS = 60

export type Competitor = { id: string; name: string; meta_page_id: string | null; linkedin_advertiser: string | null; google_advertiser_ids: string[] }

/** What we keep of one ad. `active` false = the library says it has stopped. */
export type CompetitorAd = {
  external_id: string
  started_on: string | null
  ended_on: string | null
  active: boolean
  format: string | null
  headline: string | null
  body: string | null
  cta: string | null
  landing_url: string | null
  placements: string[]
  library_url: string | null
  media_url: string | null
}

type Item = Record<string, unknown>
type Source = {
  /** The Apify actor, as `user~name`. Fixed here: nothing else is ever run. */
  actor: string
  /** Null when the competitor has no id for this library. */
  input: (c: Competitor, country: string) => Record<string, unknown> | null
  normalize: (item: Item, c: Competitor, today: string) => CompetitorAd | null
}

const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)
const obj = (v: unknown): Item => (v && typeof v === "object" && !Array.isArray(v) ? (v as Item) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const https = (v: unknown) => {
  const s = str(v, 2000)
  return s && /^https:\/\//i.test(s) ? s : null
}
const isoDay = (v: unknown) => {
  const s = str(v, 40)
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}
const unixDay = (v: unknown) => (typeof v === "number" && v > 1e9 ? new Date(v * 1000).toISOString().slice(0, 10) : null)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/** A YouTube embed or watch link → its thumbnail, so video ads still get a picture. */
export function youTubeThumb(url: unknown): string | null {
  const s = str(url, 500)
  const id = s?.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1]
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

const META_LIBRARY = "https://www.facebook.com/ads/library/"

export const SOURCES: Record<CompetitorSource, Source> = {
  // curious_coder/facebook-ads-library-scraper: reads an Ad Library page view. Cheap and the most used.
  meta: {
    actor: "curious_coder~facebook-ads-library-scraper",
    input: (c, country) =>
      c.meta_page_id
        ? {
            urls: [{ url: `${META_LIBRARY}?active_status=active&ad_type=all&country=${country}&view_all_page_id=${c.meta_page_id}&media_type=all` }],
            limitPerSource: MAX_ADS,
            count: MAX_ADS,
          }
        : null,
    normalize: (item, c) => {
      if (item.error) return null
      const id = str(item.ad_archive_id, 40)
      if (!id || !/^\d+$/.test(id)) return null
      // Another page's ad (a reseller or a search hit) isn't this competitor's.
      if (c.meta_page_id && str(item.page_id, 40) !== c.meta_page_id) return null
      const s = obj(item.snapshot)
      const card = obj(arr(s.cards)[0])
      const image = obj(arr(s.images)[0])
      const video = obj(arr(s.videos)[0])
      return {
        external_id: id,
        started_on: unixDay(item.start_date),
        ended_on: item.is_active === false ? unixDay(item.end_date) : null,
        active: item.is_active !== false,
        format: str(s.display_format, 40)?.toLowerCase() ?? null,
        headline: str(s.title, 300) ?? str(card.title, 300),
        body: str(obj(s.body).text) ?? str(card.body),
        cta: str(s.cta_text, 60) ?? str(card.cta_text, 60),
        landing_url: https(s.link_url) ?? https(card.link_url),
        placements: arr(item.publisher_platform).map((p) => String(p).toLowerCase()).slice(0, 10),
        library_url: `${META_LIBRARY}?id=${id}`,
        media_url:
          https(image.original_image_url) ?? https(image.resized_image_url) ?? https(card.original_image_url) ?? https(card.resized_image_url) ??
          https(video.video_preview_image_url) ?? https(card.video_preview_image_url),
      }
    },
  },
  // maximedupre/google-ads-scraper: the Google Ads Transparency Center, by advertiser id.
  google: {
    actor: "maximedupre~google-ads-scraper",
    input: (c, country) => (c.google_advertiser_ids.length ? { targets: c.google_advertiser_ids, maxResults: MAX_ADS, region: country, detailLevel: "details" } : null),
    normalize: (item, c, today) => {
      const id = str(item.creativeId, 60)
      if (!id || !/^CR\d+$/.test(id)) return null
      const advertiser = str(item.advertiserId, 60)
      if (!advertiser || !c.google_advertiser_ids.includes(advertiser)) return null
      const variant = obj(arr(item.variants)[0])
      const last = isoDay(item.lastShown)
      // The library has no "active" flag: shown in the last 3 days counts as running.
      const active = !last || daysBetween(last, today) <= 3
      const library = https(item.adUrl) ?? `https://adstransparency.google.com/advertiser/${advertiser}/creative/${id}`
      return {
        external_id: id,
        started_on: isoDay(item.firstShown),
        ended_on: active ? null : last,
        active,
        format: str(item.format, 40)?.toLowerCase() ?? null,
        headline: str(item.headline, 300) ?? str(variant.headline, 300),
        body: str(item.body) ?? str(variant.body) ?? (str(variant.text) !== str(variant.headline) ? str(variant.text) : null),
        cta: str(variant.cta, 60),
        // Google's click links (googleadservices.com) aren't landing pages; the display URL is.
        landing_url: https(variant.displayUrl) ?? https(item.displayUrl),
        placements: [],
        library_url: library,
        media_url: https(arr(item.imageUrls)[0]) ?? https(arr(variant.imageUrls)[0]) ?? youTubeThumb(arr(item.videoUrls)[0]) ?? youTubeThumb(arr(variant.videoUrls)[0]),
      }
    },
  },
  // fetch_cat/linkedin-ad-library-scraper: LinkedIn's public Ad Library, by advertiser name, last 30 days.
  // (automation-lab's actor returned nothing for any competitor in the trial.)
  linkedin: {
    actor: "fetch_cat~linkedin-ad-library-scraper",
    input: (c, country) => (c.linkedin_advertiser ? { advertiser: c.linkedin_advertiser, countries: [country], maxAds: MAX_ADS } : null),
    normalize: (item, c) => {
      const id = str(item.adId, 40)
      if (!id || !/^\d+$/.test(id)) return null
      // The library matches names loosely; keep only the advertiser we asked for.
      const advertiser = str(item.advertiserName, 200)?.toLowerCase()
      if (c.linkedin_advertiser && advertiser !== c.linkedin_advertiser.trim().toLowerCase()) return null
      // The first media URL is often the company logo.
      const media = arr(item.mediaUrls).map(https).find((u) => u && !/company-logo/.test(u)) ?? null
      return {
        external_id: id,
        // LinkedIn's library shows no start date; the page falls back to when we first saw the ad.
        started_on: null,
        ended_on: null,
        active: true,
        format: str(item.creativeType, 60)?.toLowerCase() ?? null,
        headline: str(item.headline, 300),
        body: str(item.creativeText),
        cta: str(item.callToAction, 60),
        landing_url: null,
        placements: [],
        library_url: https(item.adUrl)?.split("?")[0] ?? `https://www.linkedin.com/ad-library/detail/${id}`,
        media_url: media,
      }
    },
  },
}

/** Normalizes a run's items, dropping anything malformed or from another advertiser, and duplicates. */
export function normalizeItems(source: CompetitorSource, items: unknown[], c: Competitor, today: string): CompetitorAd[] {
  const seen = new Map<string, CompetitorAd>()
  for (const raw of items) {
    const ad = SOURCES[source].normalize(obj(raw), c, today)
    if (ad && !seen.has(ad.external_id)) seen.set(ad.external_id, ad)
  }
  return [...seen.values()]
}

/**
 * Whether a run can be trusted to close ads it didn't return. A run that comes back empty when the
 * competitor had live ads on this source is more likely a scraper failure than every ad stopping.
 */
export function runIsHealthy(items: number, liveBefore: number) {
  return items > 0 || liveBefore === 0
}
