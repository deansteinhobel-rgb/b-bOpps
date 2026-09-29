import type { Platform } from "@/lib/metrics/types"

/** The Reporting tab's URL params. A plain module, so server pages can call these (see CLAUDE.md). */
export const PERIODS = [7, 14, 30, 90] as const
/** The period in the URL, else the person's default from Options, else 30 days. */
export const parseDays = (v: unknown, fallback = 30) => ((PERIODS as readonly number[]).includes(Number(v)) ? Number(v) : (PERIODS as readonly number[]).includes(fallback) ? fallback : 30)
export const parsePlatform = (v: unknown): Platform | null => (v === "linkedin" || v === "google_ads" || v === "meta" ? v : null)
