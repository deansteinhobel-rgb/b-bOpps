/**
 * Phase 2 breakdowns from Windsor (search terms, keywords, impression share, Meta and GA4 daily;
 * LinkedIn 30-day totals). Reads Windsor; writes only our database.
 *   pnpm sync:breakdowns                    # daily kinds, last 3 days, plus Meta ad sets over 7 days
 *   pnpm sync:breakdowns --days 30          # backfill
 *   pnpm sync:breakdowns --kinds search_term,keyword
 *   pnpm sync:breakdowns --linkedin         # every LinkedIn breakdown (slow: minutes each)
 */
import { daysAgo } from "@/lib/windsor/sync"
import { LINKEDIN_KINDS, syncDailyBreakdowns, syncMetaWeek, syncNextLinkedInBreakdown, type Kind } from "@/lib/windsor/breakdowns"

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined }
const days = Number(arg("--days") ?? 3)
const t = Date.now()
if (process.argv.includes("--linkedin")) {
  for (let i = 0; i < LINKEDIN_KINDS.length * 4; i++) {
    const r = await syncNextLinkedInBreakdown(daysAgo(1))
    if (!r) break
    console.log(`  ${r.kind} ${r.account}: ${r.error ?? `${r.rows} rows`} (${((Date.now() - t) / 1000).toFixed(0)}s)`)
  }
} else {
  const kinds = arg("--kinds")?.split(",") as Kind[] | undefined
  const results = [...(await syncDailyBreakdowns({ from: daysAgo(days), to: daysAgo(1), kinds })), ...(kinds ? [] : await syncMetaWeek(daysAgo(1)))]
  for (const r of results) console.log(`  ${r.kind.padEnd(18)} ${r.account.padEnd(16)} ${r.error ? `FAILED: ${r.error}` : `${r.rows} rows`}`)
}
console.log(`Done in ${((Date.now() - t) / 1000).toFixed(0)}s`)
