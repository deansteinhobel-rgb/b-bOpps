import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The client's business goal for the months the report's dates touch (Dean, 2026-10-19: DNSFilter's
 * activated free trials come first on the overall report). One figure per month, entered by the team
 * (client_goals); the month in progress is "so far", with where on-pace would be today.
 */
export type GoalMonth = { month: string; label: string; value: number | null; target: number | null; inProgress: boolean; expected: number | null }
export type ReportGoal = { name: string; months: GoalMonth[] }

const monthLabel = (m: string, year: boolean) => new Intl.DateTimeFormat("en-GB", { month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(m))

export async function loadGoals(db: SupabaseClient, clientId: string, from: string, to: string, today: string): Promise<ReportGoal[]> {
  // Every month from the one `from` is in to the one `to` is in, newest first (at most 6).
  const months: string[] = []
  for (let y = Number(to.slice(0, 4)), m = Number(to.slice(5, 7)); months.length < 6; m--) {
    if (m === 0) {
      m = 12
      y--
    }
    const key = `${y}-${String(m).padStart(2, "0")}-01`
    if (key < `${from.slice(0, 7)}-01`) break
    months.push(key)
  }
  const { data: goals } = await db.from("client_goals").select("id, name, monthly_target, client_goal_values(month, value, target)").eq("client_id", clientId).eq("active", true).order("position")
  const thisMonth = `${today.slice(0, 7)}-01`
  const day = Number(today.slice(8, 10))
  const daysIn = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()
  const oneYear = months.every((m) => m.slice(0, 4) === today.slice(0, 4))
  return (goals ?? []).map((g) => {
    const values = (g.client_goal_values ?? []) as { month: string; value: number | string; target: number | string | null }[]
    return {
      name: g.name,
      months: months.map((month) => {
        const v = values.find((x) => x.month === month)
        const target = v?.target != null ? Number(v.target) : g.monthly_target != null ? Number(g.monthly_target) : null
        const inProgress = month === thisMonth
        return { month, label: monthLabel(month, !oneYear), value: v ? Number(v.value) : null, target, inProgress, expected: inProgress && target ? Math.round((target * day) / daysIn) : null }
      }),
    }
  })
}
