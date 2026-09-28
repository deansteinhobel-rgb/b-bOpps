import { NextResponse, type NextRequest } from "next/server"
import { daysAgo, syncWindsor } from "@/lib/windsor/sync"

export const maxDuration = 60

/**
 * Daily Windsor sync: the last 3 days for every active account, to catch late conversions.
 * Called by the scheduler with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const results = await syncWindsor({ dateFrom: daysAgo(3), dateTo: daysAgo(1), kind: "daily" })
  const failed = results.filter((r) => r.error)
  return NextResponse.json({ ok: failed.length === 0, results }, { status: failed.length ? 207 : 200 })
}
