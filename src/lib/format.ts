export function money(value: number | null | undefined, currency = "USD", digits = 0) {
  if (value === null || value === undefined) return "–"
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
}

export const whole = (v: number | null | undefined) => (v === null || v === undefined ? "–" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(v))

export const oneDp = (v: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(v)

export const percent = (ratio: number | null | undefined, digits = 1) =>
  ratio === null || ratio === undefined ? "–" : `${(ratio * 100).toFixed(digits)}%`

export const signedPct = (pct: number | null) => (pct === null ? "–" : `${pct > 0 ? "+" : ""}${pct}%`)

export function longDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso))
}

/** "19 Sept", for dates in the current year. */
export function shortDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso))
}

/** "$", "£", "€" for a currency code (Dean: show symbols, never "USD" or "GBP"). */
export function currencySymbol(code: string) {
  const part = new Intl.NumberFormat("en-GB", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")
  return part?.value ?? code
}

/** Swaps currency codes in free text for symbols: "USD 1,200" / "1,200 USD" → "$1,200". */
export function withSymbols(text: string) {
  return text
    .replace(/\b(USD|GBP|EUR|AUD|CAD|ZAR)\s?(-?[\d.,]+[kKmM]?)/g, (_, code: string, n: string) => `${currencySymbol(code)}${n}`)
    .replace(/(-?[\d.,]+[kKmM]?)\s?(USD|GBP|EUR|AUD|CAD|ZAR)\b/g, (_, n: string, code: string) => `${currencySymbol(code)}${n}`)
}
