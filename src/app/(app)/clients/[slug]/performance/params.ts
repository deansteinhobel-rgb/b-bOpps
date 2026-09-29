import type { Platform } from "@/lib/metrics/types"

/** The Performance tab's URL params. A plain module, so server pages can call these (see CLAUDE.md). */
export const PERIODS = [7, 14, 30, 90] as const
export const parseDays = (v: unknown) => ((PERIODS as readonly number[]).includes(Number(v)) ? Number(v) : 30)
export const parsePlatform = (v: unknown): Platform | null => (v === "linkedin" || v === "google_ads" || v === "meta" ? v : null)
