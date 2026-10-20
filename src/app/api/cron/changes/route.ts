import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { syncPlatformChanges } from "@/lib/windsor/changes"
import { daysAgo } from "@/lib/windsor/sync"
import { isCron } from "@/lib/cron-auth"

export const maxDuration = 300

/**
 * Daily: platform change history for At a glance (Google Ads change history, Meta activity log,
 * LinkedIn edited ads), yesterday and today. Google can take ~2 minutes on busy accounts.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const results = await syncPlatformChanges({ from: daysAgo(1), to: daysAgo(0) })
  revalidateTag("windsor", { expire: 0 })
  return NextResponse.json({ ok: results.every((r) => !r.error), results })
}
