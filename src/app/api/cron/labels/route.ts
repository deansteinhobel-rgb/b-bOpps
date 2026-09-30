import { NextResponse, type NextRequest } from "next/server"
import { aiConfigured } from "@/lib/ai/claude"
import { labelAds } from "@/lib/labels/ads"
import { labelTests } from "@/lib/labels/tests"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 300

/**
 * Daily labels for comparing clients (after the creatives job): Claude labels new or changed ads
 * (up to 80 per client, most spend first) and picks a lever for tests that have none. Writes
 * ad_labels and sprint_tests.lever only. Clients without an ad account are skipped.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (!aiConfigured()) return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY isn't set" })
  const stopAt = Date.now() + 240_000
  const db = createAdminClient()
  const { data: accounts } = await db.from("client_platform_accounts").select("client_id").eq("active", true)
  const clientIds = [...new Set((accounts ?? []).map((a) => a.client_id as string))]
  const results = []
  for (const clientId of clientIds) {
    if (Date.now() > stopAt) break
    try {
      const tests = await labelTests(clientId)
      const ads = await labelAds(clientId, { max: 80, stopAt })
      results.push({ clientId, tests: tests.labelled, ads: ads.labelled, adsLeft: ads.left })
    } catch (e) {
      results.push({ clientId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: results.every((r) => !("error" in r)), results })
}
