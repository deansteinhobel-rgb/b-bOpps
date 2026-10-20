import { NextResponse, type NextRequest } from "next/server"
import { londonToday } from "@/lib/checks/periods"
import { dataRanges } from "@/lib/metrics/data-range"
import { sendWeeklySnapshot } from "@/lib/reports/send"
import { lastWeek } from "@/lib/reports/weekly"
import { createAdminClient } from "@/lib/supabase/admin"
import { isCron } from "@/lib/cron-auth"

export const maxDuration = 120

/** Posts land at least this far apart (Dean, 2026-10-20: 10 minutes; the job runs every 10). */
const SPACING_MS = 9 * 60_000
/** Wait this long on Monday for the week's last day to sync before posting with what there is. */
const LAST_WAIT_HOUR = 11

const londonClock = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now)
  return { weekday: parts.find((p) => p.type === "weekday")?.value, hour: Number(parts.find((p) => p.type === "hour")?.value) }
}

/**
 * The weekly Slack snapshot (Dean, 2026-10-20): Mondays from 08:00 London, one client per call, the
 * clients with an active ad account in name order, 10 minutes apart. Supabase Cron calls it every
 * 10 minutes on Monday mornings (migration 20261020000079). Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const { weekday, hour } = londonClock()
  if (weekday !== "Mon" || hour < 8) return NextResponse.json({ ok: true, skipped: "Not Monday after 08:00 in London." })

  const db = createAdminClient()
  const week = lastWeek(londonToday())
  const [{ data: clients }, { data: posts }] = await Promise.all([
    db.from("clients").select("id, slug, name, client_platform_accounts!inner(id)").eq("active", true).eq("client_platform_accounts.active", true).order("name"),
    db.from("slack_posts").select("client_id, status, created_at").eq("period_start", week.from).eq("manual", false).order("created_at", { ascending: false }),
  ])
  const done = new Set((posts ?? []).filter((p) => p.status !== "failed").map((p) => p.client_id))
  const next = [...new Map((clients ?? []).map((c) => [c.id, c])).values()].find((c) => !done.has(c.id))
  if (!next) return NextResponse.json({ ok: true, skipped: "Every client has had this week's post." })
  const last = posts?.find((p) => p.status === "sent" || p.status === "sending")
  if (last && Date.now() - Date.parse(last.created_at) < SPACING_MS) return NextResponse.json({ ok: true, skipped: "Spacing posts 10 minutes apart." })

  // Sunday's numbers come in with the morning Windsor sync; wait for them until late morning.
  const { data: range } = await dataRanges(db, next.id)
  const through = (range ?? []).map((r) => r.data_through).sort().at(-1)
  if (through && through < week.to && hour < LAST_WAIT_HOUR) return NextResponse.json({ ok: true, skipped: `${next.slug}: data only to ${through}, waiting.` })

  const result = await sendWeeklySnapshot(db, next.id, { week })
  return NextResponse.json({ ok: result.status !== "failed", week, result: { status: result.status, client: result.client, error: result.error } })
}
