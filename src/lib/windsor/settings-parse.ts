/**
 * Reads Windsor's Meta `adset_targeting` (the ad set's targeting spec, as JSON text or an object).
 * Plain module, no server imports, so it can be tested.
 * - advantage_audience: `targeting_automation.advantage_audience` is 1 (Meta may reach beyond the audience).
 * - matched_audiences: custom audiences that aren't lookalikes (lists, website visitors...).
 * - location_types: "home", "recent" (recently in), "travel_in"...; Meta's default includes "recent".
 */
export type MetaTargeting = {
  advantage_audience: boolean | null
  matched_audiences: string[]
  lookalikes: string[]
  location_types: string[]
}

export function parseMetaTargeting(raw: unknown): MetaTargeting {
  let t: Record<string, unknown> | null = null
  if (raw && typeof raw === "object") t = raw as Record<string, unknown>
  else if (typeof raw === "string" && raw.trim()) {
    try {
      t = JSON.parse(raw) as Record<string, unknown>
    } catch {
      t = null
    }
  }
  if (!t) return { advantage_audience: null, matched_audiences: [], lookalikes: [], location_types: [] }
  const automation = (t.targeting_automation ?? {}) as Record<string, unknown>
  const audiences = Array.isArray(t.custom_audiences) ? (t.custom_audiences as { name?: unknown; id?: unknown }[]) : []
  const names = audiences.map((a) => String(a?.name ?? a?.id ?? "")).filter(Boolean)
  const isLookalike = (n: string) => /look-?alike|\blal\b/i.test(n)
  const geo = (t.geo_locations ?? {}) as Record<string, unknown>
  return {
    advantage_audience: automation.advantage_audience === undefined ? false : Number(automation.advantage_audience) === 1,
    matched_audiences: names.filter((n) => !isLookalike(n)),
    lookalikes: names.filter(isLookalike),
    location_types: Array.isArray(geo.location_types) ? (geo.location_types as unknown[]).map(String) : [],
  }
}
