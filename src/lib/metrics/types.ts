export type Platform = "linkedin" | "google_ads" | "meta" | "reddit"

/** Every connected platform, in display order. Reddit added for DNSFilter (Dean, 2026-10-15). */
export const PLATFORMS: readonly Platform[] = ["linkedin", "google_ads", "meta", "reddit"]

export const isPlatform = (v: unknown): v is Platform => typeof v === "string" && (PLATFORMS as readonly string[]).includes(v)

export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  google_ads: "Google Ads",
  meta: "Meta",
  reddit: "Reddit",
}
