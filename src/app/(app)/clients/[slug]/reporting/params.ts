import { type Platform, isPlatform } from "@/lib/metrics/types"

/** The Reporting tab's URL params. A plain module, so server pages can call these (see CLAUDE.md). */
export { parseRange } from "@/lib/metrics/range"
export const parsePlatform = (v: unknown): Platform | null => (isPlatform(v) ? v : null)
