import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { snapshotAdFatigue } from "@/lib/metrics/fatigue-snapshot"
import { createAdminClient } from "@/lib/supabase/admin"
import { syncCampaignStatuses } from "@/lib/windsor/statuses"
import { daysAgo, syncWindsor } from "@/lib/windsor/sync"
import { isCron } from "@/lib/cron-auth"

export const maxDuration = 300

/**
 * Daily Windsor sync: the last 14 days for every active account, because the platforms credit conversions days after the click, then
 * each campaign's current status (so "stopped spending" can ignore paused campaigns), then the day's live ads and ad
 * fatigue per client (ad_fatigue_snapshots), so pages don't work them out on every visit.
 * Called by the scheduler with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const results = await syncWindsor({ dateFrom: daysAgo(14), dateTo: daysAgo(1), kind: "daily" })
  const statuses = await syncCampaignStatuses({ to: daysAgo(0) })
  for (const s of statuses) if (s.error) results.push({ client_id: "", account: `status ${s.account}`, rows: 0, error: s.error })
  // Live ads and ad fatigue for the day, worked out once now that the numbers are in (Dean, 2026-10-15).
  for (const s of await snapshotAdFatigue(createAdminClient())) if (s.error) results.push({ client_id: s.client_id, account: "ad fatigue snapshot", rows: 0, error: s.error })
  revalidateTag("windsor", { expire: 0 }) // fresh numbers everywhere
  const failed = results.filter((r) => r.error)
  return NextResponse.json({ ok: failed.length === 0, results }, { status: failed.length ? 207 : 200 })
}
