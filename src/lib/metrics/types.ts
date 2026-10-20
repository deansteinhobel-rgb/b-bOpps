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

/** Platform colors (validated for the dark surface: lightness band, chroma, color-blind separation). Always shown with the platform's logo and name. */
export const PLATFORM_COLOR: Record<Platform, string> = { linkedin: "#7f6ae0", google_ads: "#869a14", meta: "#cf4f86", reddit: "#2aa198" }
