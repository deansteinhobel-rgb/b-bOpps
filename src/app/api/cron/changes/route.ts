import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { syncPlatformChanges } from "@/lib/windsor/changes"
import { daysAgo } from "@/lib/windsor/sync"

export const maxDuration = 300

/**
 * Daily: platform change history for the Account tab (Google Ads change history, Meta activity log,
 * LinkedIn edited ads), yesterday and today. Google can take ~2 minutes on busy accounts.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const results = await syncPlatformChanges({ from: daysAgo(1), to: daysAgo(0) })
  revalidateTag("windsor", { expire: 0 })
  return NextResponse.json({ ok: results.every((r) => !r.error), results })
}
