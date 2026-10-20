import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { syncPlatformSettings } from "@/lib/windsor/settings"
import { daysAgo } from "@/lib/windsor/sync"
import { isCron } from "@/lib/cron-auth"

export const maxDuration = 300

/**
 * Daily: platform settings (Google location option, networks, AI Max; Meta Advantage+ audience and
 * locations; LinkedIn and Meta Audience Network spend) for the urgent settings insights in Optimize now.
 * Runs before the morning insights review. Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const results = await syncPlatformSettings({ to: daysAgo(0) })
  revalidateTag("windsor", { expire: 0 })
  return NextResponse.json({ ok: results.every((r) => !r.error), results }, { status: results.some((r) => r.error) ? 207 : 200 })
}
