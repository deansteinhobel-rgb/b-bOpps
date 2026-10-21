/**
 * The Meta ids a build may use, read from what the account's own ads and ad sets already use
 * (Dean, 2026-10-21). A plain module so the tests can use it.
 *
 * - The Facebook page: each ad's `actor_id` (Windsor's "Facebook Page ID"). Ad sets only name a page
 *   in their promoted object when they optimize for leads, so website conversion accounts (Filevine)
 *   had none.
 * - Conversions: an ad set's promoted object. A standard or custom event by name, or a custom
 *   conversion (`custom_conversion_id`, a pixel rule naming the event), which Meta needs by id.
 *
 * Never ask Windsor for an `actions_*` field in the same request: Meta zeroes spend or refuses it.
 */

export type MetaConversion = { pixelId: string; event: string; customConversionId?: string }

const digits = (v: unknown) => (typeof v === "string" || typeof v === "number") && /^\d+$/.test(String(v)) ? String(v) : null

/** Windsor returns JSON fields as strings; anything that isn't an object reads as null. */
export function jsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The first `{ event: { eq: "…" } }` in a pixel rule (custom conversions keep their event there). */
function ruleEvent(rule: unknown): string | null {
  const walk = (v: unknown): string | null => {
    if (Array.isArray(v)) {
      for (const x of v) {
        const found = walk(x)
        if (found) return found
      }
      return null
    }
    if (!v || typeof v !== "object") return null
    const o = v as Record<string, unknown>
    const eq = (o.event as { eq?: unknown } | undefined)?.eq
    if (typeof eq === "string" && eq) return eq
    for (const x of Object.values(o)) {
      const found = walk(x)
      if (found) return found
    }
    return null
  }
  return walk(typeof rule === "string" ? jsonObject(rule) : rule)
}

/** An ad set's promoted object → the page it names (lead ads) and the conversion it optimizes for. */
export function promotedOf(raw: unknown): { pageId: string | null; conversion: MetaConversion | null } {
  const p = jsonObject(raw)
  if (!p) return { pageId: null, conversion: null }
  const pixelId = digits(p.pixel_id)
  const custom = digits(p.custom_conversion_id)
  const type = typeof p.custom_event_type === "string" ? p.custom_event_type : ""
  const event = (typeof p.custom_event_str === "string" && p.custom_event_str) || ruleEvent(p.pixel_rule) || (type && type !== "OTHER" ? type : "")
  return {
    pageId: digits(p.page_id),
    conversion: pixelId && (event || custom) ? { pixelId, event: event || `Custom conversion ${custom}`, ...(custom ? { customConversionId: custom } : {}) } : null,
  }
}

/** One key per conversion, for de-duplicating and for select values. */
export const conversionKey = (c: MetaConversion) => [c.pixelId, c.event, c.customConversionId ?? ""].join("|")
export function fromConversionKey(key: string): MetaConversion | null {
  const [pixelId, event, custom] = key.split("|")
  if (!digits(pixelId) || !event) return null
  return { pixelId, event, ...(digits(custom) ? { customConversionId: custom } : {}) }
}

/** The page ids an account's ads run as, most used first. */
export function pagesOf(rows: { actor_id?: unknown; spend?: unknown }[]): string[] {
  const spend = new Map<string, number>()
  for (const r of rows) {
    const id = digits(r.actor_id)
    if (id) spend.set(id, (spend.get(id) ?? 0) + (Number(r.spend) || 0))
  }
  return [...spend.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
