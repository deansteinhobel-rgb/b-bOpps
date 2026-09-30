/**
 * Campaign segments (Dean, 2026-09-30): some clients run separate programs whose campaigns sit
 * side by side on every platform, e.g. Camber's SMB and ABX (account-based, named "ABM" on LinkedIn).
 * The campaign name says which one a campaign belongs to, so a segment is a rule on the name.
 * Anything no rule matches is "Other" (brand search, retargeting, events...). A plain module, so the
 * server pages and the toolbar can both use it.
 */

import { add, derive, zero, type Derived, type Performance, type Sums } from "./performance"
import type { Platform } from "./types"

export type SegmentDef = { key: string; label: string; pattern: RegExp; hint: string; color: string }
export type SegmentOption = { key: string; label: string; hint: string; color: string }

export const OTHER_SEGMENT = "other"
const OTHER_COLOR = "#8a8a8a"

/**
 * Colors (Dean, 2026-09-30: tell SMB and ABX apart at a glance): sky and orange, clear of the
 * platform colors (LinkedIn purple, Google olive, Meta pink), lime and each other on dark.
 */
const CLIENT_SEGMENTS: Record<string, SegmentDef[]> = {
  camber: [
    { key: "smb", label: "SMB", pattern: /^\s*SMB\b/i, hint: "Campaigns whose name starts with SMB", color: "#38bdf8" },
    { key: "abx", label: "ABX", pattern: /^\s*AB[XM]\b/i, hint: "Campaigns whose name starts with ABX or ABM (account-based)", color: "#ff8a3d" },
  ],
}

/** A client's segment rules (by slug); empty when it has none. */
export const segmentsFor = (slug: string): SegmentDef[] => CLIENT_SEGMENTS[slug] ?? []

/** The options to pick from: each segment, then Other. */
export const segmentOptions = (defs: SegmentDef[]): SegmentOption[] =>
  defs.length
    ? [...defs.map(({ key, label, hint, color }) => ({ key, label, hint, color })), { key: OTHER_SEGMENT, label: "Other", hint: `Campaigns that fit none of ${defs.map((d) => d.label).join(" or ")}, e.g. brand search or retargeting`, color: OTHER_COLOR }]
    : []

/** Which segment a campaign name belongs to. */
export const segmentOf = (defs: SegmentDef[], name: string | null | undefined) => defs.find((d) => d.pattern.test(name ?? ""))?.key ?? OTHER_SEGMENT

export const segmentLabel = (defs: SegmentDef[], key: string) => segmentOptions(defs).find((o) => o.key === key)?.label ?? key

/** The `segment` URL param, if it names one of this client's segments. */
export const parseSegment = (defs: SegmentDef[], v: unknown): string | null => (typeof v === "string" && segmentOptions(defs).some((o) => o.key === v) ? v : null)

/** For cache keys: changes whenever the rules do. */
export const segmentsFingerprint = (defs: SegmentDef[]) => defs.map((d) => `${d.key}:${d.pattern.source}`).join(",")

type Part = { now: Derived; prev: Derived }
export type SegmentTotals = SegmentOption & Part & { platforms: ({ platform: Platform } & Part)[] }

/** Sums the page's campaigns by segment, and within each segment by platform. */
export function splitBySegment(perf: Performance, defs: SegmentDef[], options: SegmentOption[]): SegmentTotals[] {
  const acc = new Map<string, Map<Platform, { now: Sums; prev: Sums }>>()
  for (const c of perf.campaigns) {
    const seg = segmentOf(defs, c.name)
    const byPlatform = acc.get(seg) ?? new Map()
    const had = byPlatform.get(c.platform) ?? { now: zero(), prev: zero() }
    byPlatform.set(c.platform, { now: add(had.now, c.now), prev: add(had.prev, c.prev) })
    acc.set(seg, byPlatform)
  }
  return options
    .map((o) => {
      const byPlatform = [...(acc.get(o.key) ?? new Map<Platform, { now: Sums; prev: Sums }>()).entries()]
      const now = byPlatform.reduce((s, [, v]) => add(s, v.now), zero())
      const prev = byPlatform.reduce((s, [, v]) => add(s, v.prev), zero())
      return {
        ...o,
        now: derive(now),
        prev: derive(prev),
        platforms: byPlatform.map(([platform, v]) => ({ platform, now: derive(v.now), prev: derive(v.prev) })).sort((a, b) => b.now.spend - a.now.spend),
      }
    })
    .filter((s) => s.now.spend > 0 || s.prev.spend > 0 || s.key !== OTHER_SEGMENT)
}
