import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { londonToday } from "@/lib/checks/periods"
import { addDays } from "@/lib/metrics/ads"
import type { Platform } from "@/lib/metrics/types"
import type { SprintTest } from "./data"
import type { TestTotals } from "./tests"

/** Links on the Notion brief that show "what we created" (url and files properties on the board). */
const LINK_PROPS = ["Figma Board", "Campaign Folder", "Brief Uploads / Links", "Useful Links", "Proposal Deck"]

export type BriefInfo = { status: string | null; url: string; links: { label: string; href: string | null; text: string }[] }
export type Campaign = { platform: Platform; campaign_id: string; campaign_name: string; spend: number; last_date: string }

/** Everything the test cards need beyond the tests themselves. User's client: RLS applies. */
export async function testBoardData(supabase: SupabaseClient, clientId: string, tests: SprintTest[]) {
  const pageIds = tests.map((t) => t.notion_page_id).filter(Boolean) as string[]
  const today = londonToday()
  const [{ data: pages }, { data: campaigns }, results] = await Promise.all([
    pageIds.length
      ? supabase.from("notion_pages_mirror").select("notion_page_id, url, properties").in("notion_page_id", pageIds)
      : Promise.resolve({ data: [] as { notion_page_id: string; url: string; properties: Record<string, unknown> }[] }),
    supabase.rpc("client_campaigns", { p_client: clientId, p_from: addDays(today, -30) }),
    Promise.all(
      tests
        .filter((t) => t.live_on && t.campaign_ids.length)
        .map(async (t) => {
          const { data } = await supabase.rpc("campaign_totals", { p_client: clientId, p_platform: t.platform, p_campaign_ids: t.campaign_ids, p_from: t.live_on, p_to: today })
          const r = (data?.[0] ?? {}) as Record<string, unknown>
          const totals: TestTotals = {
            spend: Number(r.spend) || 0,
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            conversions: Number(r.conversions) || 0,
            leads: Number(r.leads) || 0,
            days: Number(r.days) || 0,
            data_through: (r.data_through as string) ?? null,
          }
          return [t.id, totals] as const
        }),
    ),
  ])

  const briefs: Record<string, BriefInfo> = {}
  for (const p of pages ?? []) {
    const props = p.properties as Record<string, unknown>
    const links: BriefInfo["links"] = []
    for (const label of LINK_PROPS) {
      const v = props[label]
      for (const item of Array.isArray(v) ? v : v ? [v] : []) {
        const s = String(item)
        links.push({ label, href: s.startsWith("http") ? s : null, text: s.startsWith("http") ? new URL(s).hostname.replace(/^www\./, "") : s })
      }
    }
    briefs[p.notion_page_id] = { status: (props["Master Status"] as string) ?? null, url: p.url, links }
  }

  return {
    briefs,
    results: Object.fromEntries(results) as Record<string, TestTotals>,
    campaigns: ((campaigns ?? []) as Record<string, unknown>[]).map((c) => ({
      platform: c.platform as Platform,
      campaign_id: c.campaign_id as string,
      campaign_name: (c.campaign_name as string) ?? (c.campaign_id as string),
      spend: Number(c.spend) || 0,
      last_date: c.last_date as string,
    })) as Campaign[],
  }
}
