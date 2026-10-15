// MOCK funnel numbers (Dean, 2026-10-15): MQLs, SQLs and pipeline against target on the All clients
// screen, until we read them from each client's CRM (HubSpot is still stubbed). Every number here is
// made up, fixed per client (from its slug) so the cards don't jump around, and shown as "Sample" in the
// UI. Replace `mockFunnel` with real figures; the card only needs the FunnelMetric shape.
// A plain module: used by server and client components.

export type FunnelMetric = { key: "mql" | "sql" | "pipeline"; label: string; hint: string; value: number; target: number; money: boolean }
export type Funnel = { metrics: FunnelMetric[]; sample: boolean }

/** A stable number in [0, 1) from a string and a salt. */
function seeded(text: string, salt: number) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10_000) / 10_000
}

/** Sample MQL, SQL and pipeline for this month so far, against the month's targets. `pace` = share of the month gone. */
export function mockFunnel(slug: string, pace: number): Funnel {
  const r = (salt: number) => seeded(slug, salt)
  const mqlTarget = Math.round((80 + r(1) * 220) / 10) * 10
  const sqlTarget = Math.max(5, Math.round(mqlTarget * (0.22 + r(2) * 0.16)))
  const pipeTarget = Math.round((sqlTarget * (6_000 + r(3) * 14_000)) / 5_000) * 5_000
  // How far along each one is against where it should be by now (0.65 to 1.25 of pace).
  const at = (salt: number, target: number) => Math.round(target * pace * (0.65 + r(salt) * 0.6))
  return {
    sample: true,
    metrics: [
      { key: "mql", label: "MQLs", hint: "Marketing qualified leads this month", value: at(4, mqlTarget), target: mqlTarget, money: false },
      { key: "sql", label: "SQLs", hint: "Sales qualified leads this month", value: at(5, sqlTarget), target: sqlTarget, money: false },
      { key: "pipeline", label: "Pipeline", hint: "New pipeline created this month", value: at(6, pipeTarget), target: pipeTarget, money: true },
    ],
  }
}

/** Where a metric stands against where it should be by today: "12% ahead", "On pace" (within 10%), "20% behind". */
export function paceOf(value: number, target: number, pace: number): { tone: "green" | "amber" | "red"; words: string } {
  const expected = target * pace
  if (expected <= 0) return { tone: "green", words: "Month just started" }
  const diff = value / expected - 1
  if (diff >= 0.1) return { tone: "green", words: `${Math.round(diff * 100)}% ahead` }
  if (diff >= -0.1) return { tone: "green", words: "On pace" }
  if (diff >= -0.25) return { tone: "amber", words: `${Math.round(-diff * 100)}% behind` }
  return { tone: "red", words: `${Math.round(-diff * 100)}% behind` }
}
