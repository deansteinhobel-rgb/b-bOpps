/**
 * Budget pacing (brief + CLAUDE.md):
 *   expected = monthly budget × days elapsed ÷ days in month
 *   Green within ±10% of expected. Amber outside ±10%.
 *   Red when spend is more than 20% over expected, or spend is zero on the last 2 available days
 *   while the budget is above zero.
 * "Days elapsed" counts up to the data-through date, not today, because Windsor data is a day old.
 */

export type PacingStatus = "green" | "amber" | "red" | "no_budget"

export type PacingInput = {
  /** Spend from the 1st of the data-through month up to and including the data-through date. */
  spendMtd: number
  /** Budget for that month. null or 0 means no budget is set. */
  budget: number | null
  /** Last date we have data for (YYYY-MM-DD). Its month is the month being paced. */
  dataThrough: string
  /** Spend on the last two available days (data-through and the day before). Missing days are 0. */
  lastTwoDaysSpend: [number, number]
}

export type PacingResult = {
  status: PacingStatus
  month: string // YYYY-MM
  daysElapsed: number
  daysInMonth: number
  expected: number
  /** spend ÷ expected; 1 = exactly on pace. null when there is no budget. */
  ratio: number | null
  /** ratio − 1 as a percentage, e.g. +35 or −59. */
  variancePct: number | null
  reasons: string[]
}

export const AMBER_BAND = 0.1
export const RED_OVERSPEND = 0.2
const EPS = 1e-9

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

export function calculatePacing(input: PacingInput): PacingResult {
  const [y, m, d] = input.dataThrough.split("-").map(Number)
  if (!y || !m || !d) throw new Error(`Invalid dataThrough: ${input.dataThrough}`)
  const dim = daysInMonth(y, m)
  const month = input.dataThrough.slice(0, 7)
  const base = { month, daysElapsed: d, daysInMonth: dim }

  if (!input.budget || input.budget <= 0) {
    return { ...base, status: "no_budget", expected: 0, ratio: null, variancePct: null, reasons: ["No budget set for this month"] }
  }

  const expected = (input.budget * d) / dim
  const ratio = input.spendMtd / expected
  const variancePct = Math.round((ratio - 1) * 1000) / 10
  const reasons: string[] = []
  let status: PacingStatus = "green"

  const zeroSpend = input.lastTwoDaysSpend.every((s) => s === 0)
  if (zeroSpend) {
    status = "red"
    reasons.push("No spend on the last 2 available days")
  }
  // EPS: exactly ±10% / +20% sit inside the band despite floating point (9900 / 9000 = 1.1000000000000001).
  if (ratio > 1 + RED_OVERSPEND + EPS) {
    status = "red"
    reasons.push(`Overspending: ${variancePct}% above pace`)
  } else if (Math.abs(ratio - 1) > AMBER_BAND + EPS) {
    if (status !== "red") status = "amber"
    reasons.push(ratio > 1 ? `${variancePct}% above pace` : `${Math.abs(variancePct)}% below pace`)
  }
  return { ...base, status, expected, ratio, variancePct, reasons }
}
