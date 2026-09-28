import { NextResponse, type NextRequest } from "next/server"
import { syncCreatives } from "@/lib/windsor/creatives"
import { daysAgo } from "@/lib/windsor/sync"

export const maxDuration = 60

/**
 * Daily ad previews: ads seen in the last 3 days, saving up to 40 new images per run so the request
 * stays short. Reads Windsor; writes our database and storage only.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const results = await syncCreatives({ dateFrom: daysAgo(3), dateTo: daysAgo(1), maxCopies: 40 })
  return NextResponse.json({ ok: results.every((r) => !r.error), results })
}
