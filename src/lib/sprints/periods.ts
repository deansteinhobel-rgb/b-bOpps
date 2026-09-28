/**
 * Sprints are two weeks, the same fortnight for every client (Dean, 2026-09-28), on alternate
 * Mondays counted from Sprint 1 = Monday 28 September 2026. Dates are Europe/London calendar days.
 */
export const SPRINT_ANCHOR = "2026-09-28"
export const SPRINT_DAYS = 14

export type SprintPeriod = { number: number; start: string; end: string }

const dayMs = 864e5
const toDay = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / dayMs)
const fromDay = (d: number) => new Date(d * dayMs).toISOString().slice(0, 10)

export function sprintOf(isoDate: string): SprintPeriod {
  const offset = toDay(isoDate) - toDay(SPRINT_ANCHOR)
  const index = Math.floor(offset / SPRINT_DAYS)
  const startDay = toDay(SPRINT_ANCHOR) + index * SPRINT_DAYS
  return { number: index + 1, start: fromDay(startDay), end: fromDay(startDay + SPRINT_DAYS - 1) }
}

export function sprintByNumber(n: number): SprintPeriod {
  const startDay = toDay(SPRINT_ANCHOR) + (n - 1) * SPRINT_DAYS
  return { number: n, start: fromDay(startDay), end: fromDay(startDay + SPRINT_DAYS - 1) }
}

/** 1-based day within the sprint (1..14), for "Day 3 of 14". */
export const sprintDay = (p: SprintPeriod, isoDate: string) => Math.min(Math.max(toDay(isoDate) - toDay(p.start) + 1, 1), SPRINT_DAYS)
