import { NextResponse, type NextRequest } from "next/server"
import { pump, queueWeek } from "@/lib/competitors/sync"
import { isCron } from "@/lib/cron-auth"

export const maxDuration = 300

/**
 * Competitor ads, weekly (Supabase Cron `competitor-ads-weekly`, Sunday mornings): `?step=queue`
 * queues the week's runs, then `?step=pump` (every half hour) starts and collects them and copies
 * images. Reads the public ad libraries through Apify; writes our database and storage only.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const step = request.nextUrl.searchParams.get("step")
  const queued = step === "queue" ? await queueWeek() : null
  const pumped = await pump({ stopAt: Date.now() + 240_000 })
  return NextResponse.json({ ok: !pumped.errors.length, queued, ...pumped })
}
