import { NextResponse, type NextRequest } from "next/server"
import { aiConfigured } from "@/lib/ai/claude"
import { checkCompetitorRelevance, checkKeywordRelevance } from "@/lib/competitors/relevance"
import { labelAds, labelCompetitorAds } from "@/lib/labels/ads"
import { labelTests } from "@/lib/labels/tests"
import { createAdminClient } from "@/lib/supabase/admin"
import { isCron } from "@/lib/cron-auth"

export const maxDuration = 300

/**
 * Daily labels for comparing clients (after the creatives job): Claude labels new or changed ads
 * (up to 80 per client, most spend first), then competitors' live ads that are new or changed (up
 * to 60), checks keyword ads' relevance (new or changed top 30s), and picks a lever for tests that
 * have none. Writes ad_labels, competitor_ads' labels, keyword_ads' relevance and sprint_tests.lever only. Clients without an ad account are skipped.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCron(request)) {
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
      const competitors = Date.now() < stopAt ? await labelCompetitorAds(clientId, { max: 60, stopAt }) : { labeled: 0 }
      const relevance = Date.now() < stopAt ? await checkKeywordRelevance(clientId, { stopAt }) : { checked: 0 }
      const competitorRelevance = Date.now() < stopAt ? await checkCompetitorRelevance(clientId, { stopAt }) : { checked: 0 }
      results.push({ clientId, tests: tests.labeled, ads: ads.labeled, adsLeft: ads.left, competitorAds: competitors.labeled, keywordAdsChecked: relevance.checked, competitorAdsChecked: competitorRelevance.checked })
    } catch (e) {
      results.push({ clientId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: results.every((r) => !("error" in r)), results })
}
