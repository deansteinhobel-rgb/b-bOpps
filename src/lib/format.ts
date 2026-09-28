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
