/**
 * Reporting date ranges (Dean, 2026-09-30): the quick 7/14/30/90 days, calendar presets and custom
 * from/to dates, for the Reporting tab and the Notion embeds. A plain module (server and client).
 *
 * Everything is relative to the latest day we have data for (`dataThrough`), not today, because
 * Windsor is a day behind. Each range is compared with the one before it: the same days last
 * month / quarter / year for "to date" presets, the previous whole month / quarter / year for the
 * "last" presets, and the same number of days before for everything else. All time has nothing to
 * compare with.
 */

export const QUICK_DAYS = [7, 14, 30, 90] as const
export const PRESETS = ["mtd", "last_month", "qtd", "last_quarter", "ytd", "last_year", "all"] as const
export type Preset = (typeof PRESETS)[number]
export type RangeSpec = { kind: "days"; days: number } | { kind: "preset"; preset: Preset } | { kind: "custom"; from: string; to: string }
export type Bucket = "day" | "week" | "month"

export const PRESET_LABEL: Record<Preset, string> = {
  mtd: "This month",
  last_month: "Last month",
  qtd: "This quarter",
  last_quarter: "Last quarter",
  ytd: "This year",
  last_year: "Last year",
  all: "All time",
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const validIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v)

/** Reads a range from URL params (`days`, `range`, `from` + `to`), else the fallback. */
export function parseRange(sp: Record<string, unknown>, fallback: RangeSpec | number = 30): RangeSpec {
  const from = one(sp.from)
  const to = one(sp.to)
  if (validIso(from) && validIso(to) && from <= to) return { kind: "custom", from, to }
  const range = one(sp.range)
  if (typeof range === "string") {
    const r = decodeRange(range)
    if (r) return r
  }
  const days = Number(one(sp.days))
  if ((QUICK_DAYS as readonly number[]).includes(days)) return { kind: "days", days }
  if (typeof fallback === "number") return { kind: "days", days: (QUICK_DAYS as readonly number[]).includes(fallback) ? fallback : 30 }
  return fallback
}

/** A range as one short string (cache keys, the embed's saved default): "30", "qtd", "2026-07-01..2026-09-30". */
export function encodeRange(r: RangeSpec): string {
  return r.kind === "days" ? String(r.days) : r.kind === "preset" ? r.preset : `${r.from}..${r.to}`
}
export function decodeRange(v: string | null | undefined): RangeSpec | null {
  if (!v) return null
  if ((PRESETS as readonly string[]).includes(v)) return { kind: "preset", preset: v as Preset }
  const days = Number(v)
  if ((QUICK_DAYS as readonly number[]).includes(days)) return { kind: "days", days }
  const [from, to] = v.split("..")
  if (validIso(from) && validIso(to) && from <= to) return { kind: "custom", from, to }
  return null
}

/** URL params for a range (merged into the page's other params). */
export function rangeParams(r: RangeSpec, q = new URLSearchParams(), defaultDays = 30) {
  q.delete("days")
  q.delete("range")
  q.delete("from")
  q.delete("to")
  if (r.kind === "days" && r.days !== defaultDays) q.set("days", String(r.days))
  if (r.kind === "preset") q.set("range", r.preset)
  if (r.kind === "custom") {
    q.set("from", r.from)
    q.set("to", r.to)
  }
  return q
}

export const sameRange = (a: RangeSpec, b: RangeSpec) => encodeRange(a) === encodeRange(b)

// --- Dates (plain YYYY-MM-DD strings, UTC arithmetic) ---
const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (x: Date) => x.toISOString().slice(0, 10)
export const addDaysIso = (v: string, n: number) => iso(new Date(d(v).getTime() + n * 864e5))
export const daysBetween = (from: string, to: string) => Math.round((d(to).getTime() - d(from).getTime()) / 864e5) + 1
const addMonths = (v: string, n: number) => {
  const x = d(v)
  const day = x.getUTCDate()
  x.setUTCDate(1)
  x.setUTCMonth(x.getUTCMonth() + n)
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()
  x.setUTCDate(Math.min(day, last))
  return iso(x)
}
const monthStart = (v: string) => `${v.slice(0, 7)}-01`
const quarterStart = (v: string) => `${v.slice(0, 4)}-${String(Math.floor((Number(v.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`
const yearStart = (v: string) => `${v.slice(0, 4)}-01-01`

export type Periods = { from: string; to: string; prevFrom: string; prevTo: string; days: number; compare: boolean; bucket: Bucket; label: string }

/** The range's dates, the dates it's compared with, and how finely to chart it. */
export function resolveRange(r: RangeSpec, dataThrough: string, dataFrom: string): Periods {
  let from: string
  let to: string
  let prevFrom: string
  let prevTo: string
  let label: string
  let compare = true
  const before = (f: string, t: string) => {
    const n = daysBetween(f, t)
    return [addDaysIso(f, -n), addDaysIso(f, -1)] as const
  }
  if (r.kind === "days") {
    to = dataThrough
    from = addDaysIso(to, -(r.days - 1))
    ;[prevFrom, prevTo] = before(from, to)
    label = `Last ${r.days} days`
  } else if (r.kind === "custom") {
    from = r.from
    to = r.to
    ;[prevFrom, prevTo] = before(from, to)
    label = "Custom"
  } else {
    const t = dataThrough
    label = PRESET_LABEL[r.preset]
    switch (r.preset) {
      case "mtd":
      case "qtd":
      case "ytd": {
        const step = r.preset === "mtd" ? 1 : r.preset === "qtd" ? 3 : 12
        from = r.preset === "mtd" ? monthStart(t) : r.preset === "qtd" ? quarterStart(t) : yearStart(t)
        to = t
        prevFrom = addMonths(from, -step)
        prevTo = addMonths(to, -step)
        if (prevTo >= from) prevTo = addDaysIso(from, -1)
        break
      }
      case "last_month":
      case "last_quarter":
      case "last_year": {
        const step = r.preset === "last_month" ? 1 : r.preset === "last_quarter" ? 3 : 12
        const start = r.preset === "last_month" ? monthStart(t) : r.preset === "last_quarter" ? quarterStart(t) : yearStart(t)
        from = addMonths(start, -step)
        to = addDaysIso(start, -1)
        prevFrom = addMonths(from, -step)
        prevTo = addDaysIso(from, -1)
        break
      }
      case "all": {
        from = dataFrom
        to = t
        ;[prevFrom, prevTo] = before(from, to)
        compare = false
        break
      }
    }
  }
  const days = daysBetween(from, to)
  return { from, to, prevFrom, prevTo, days, compare, bucket: days <= 120 ? "day" : days <= 730 ? "week" : "month", label }
}

/** The start of the bucket a day falls in (weeks start on Monday), never before `from`. */
export function bucketStart(date: string, bucket: Bucket, from: string): string {
  let s = date
  if (bucket === "week") {
    const dow = (d(date).getUTCDay() + 6) % 7
    s = addDaysIso(date, -dow)
  } else if (bucket === "month") s = monthStart(date)
  return s < from ? from : s
}

/** Every bucket start from `from` to `to`. */
export function bucketsFor(from: string, to: string, bucket: Bucket): string[] {
  const out: string[] = []
  for (let x = from; x <= to; ) {
    out.push(x)
    x = bucket === "day" ? addDaysIso(x, 1) : bucket === "week" ? addDaysIso(bucketStart(x, "week", "0000-01-01"), 7) : addMonths(monthStart(x), 1)
  }
  return out
}

/** "29 Sept", or "29 Sept 2025" with the year. */
export const dayText = (v: string, year: boolean) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(d(v))

/** "1 Jul – 29 Sept", with years when the range isn't all in the latest data's year. */
export function rangeText(from: string, to: string, latest: string) {
  const year = from.slice(0, 4) !== latest.slice(0, 4) || to.slice(0, 4) !== latest.slice(0, 4)
  return `${dayText(from, year)} – ${dayText(to, year)}`
}

/** A range in words: "Last 30 days", "This quarter", "1 Jul 2026 – 30 Sept 2026". */
export const rangeLabel = (r: RangeSpec) => (r.kind === "days" ? `Last ${r.days} days` : r.kind === "preset" ? PRESET_LABEL[r.preset] : `${dayText(r.from, true)} – ${dayText(r.to, true)}`)
