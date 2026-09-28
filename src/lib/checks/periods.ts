/** Check periods (CLAUDE.md): weeks run Monday to Sunday, Europe/London; months are calendar months. */

export type Cadence = "weekly" | "monthly"
export type Period = { cadence: Cadence; start: string; end: string }

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)

/** Today's date in Europe/London as YYYY-MM-DD. */
export function londonToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

export function weekOf(isoDate: string): Period {
  const dow = new Date(isoDate + "T00:00:00Z").getUTCDay() // 0 = Sunday
  const start = addDays(isoDate, dow === 0 ? -6 : 1 - dow)
  return { cadence: "weekly", start, end: addDays(start, 6) }
}

export function monthOf(isoDate: string): Period {
  const [y, m] = isoDate.split("-").map(Number)
  const start = `${isoDate.slice(0, 7)}-01`
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { cadence: "monthly", start, end }
}

export const currentPeriods = (now = new Date()) => {
  const today = londonToday(now)
  return { today, weekly: weekOf(today), monthly: monthOf(today) }
}
