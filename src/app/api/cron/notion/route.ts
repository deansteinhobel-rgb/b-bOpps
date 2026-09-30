import { NextResponse, type NextRequest } from "next/server"
import { syncNotionMirror } from "@/lib/notion/sync"

export const maxDuration = 60

/**
 * Notion mirror sync. Read-only toward Notion.
 *   GET /api/cron/notion          incremental (every 15 minutes)
 *   GET /api/cron/notion?full=1   full reconcile (nightly), marks vanished pages as trashed
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const result = await syncNotionMirror({ full: request.nextUrl.searchParams.get("full") === "1" })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error("Notion sync failed", e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
