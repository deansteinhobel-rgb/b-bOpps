import { NextResponse, type NextRequest } from "next/server"
import { syncDailyBreakdowns, syncNextLinkedInBreakdown } from "@/lib/windsor/breakdowns"
import { daysAgo } from "@/lib/windsor/sync"

export const maxDuration = 300

/**
 * Phase 2 breakdowns. Reads Windsor; writes our database only.
 *   GET /api/cron/breakdowns            daily: search terms, keywords, impression share, Meta, GA4 (last 3 days, ~1 minute)
 *   GET /api/cron/breakdowns?linkedin=1 one LinkedIn 30-day breakdown, the stalest first (2-4 minutes each; each one
 *                                      refreshes weekly, so run it every 30 minutes for a few hours overnight)
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (request.nextUrl.searchParams.get("linkedin")) {
    const r = await syncNextLinkedInBreakdown(daysAgo(1))
    return NextResponse.json({ ok: !r?.error, result: r ?? "all LinkedIn breakdowns are up to date" })
  }
  const results = await syncDailyBreakdowns({ from: daysAgo(3), to: daysAgo(1) })
  return NextResponse.json({ ok: results.every((r) => !r.error), results })
}
