import "server-only"
import type { Db } from "@/lib/supabase/db"
import { londonToday } from "@/lib/checks/periods"
import { addDays } from "@/lib/metrics/ads"
import type { Platform } from "@/lib/metrics/types"
import { previewsFor, type PreviewMap } from "@/lib/previews"
import type { SprintTest } from "./data"
import type { TestDetail } from "./results"
import { loadTestDetail } from "./test-results"
import type { TestTotals } from "./tests"
import type { Targets } from "@/lib/targets"
import { hostOf } from "@/lib/format"
import { notionPageUrl } from "@/lib/notion/mirror"

/** Links on the Notion brief that show "what we created" (url and files properties on the board). */
const LINK_PROPS = ["Figma Board", "Campaign Folder", "Brief Uploads / Links", "Useful Links", "Proposal Deck"]

export type BriefInfo = { status: string | null; paid: string | null; url: string; links: { label: string; href: string | null; text: string }[] }
export type Campaign = { platform: Platform; campaign_id: string; campaign_name: string; spend: number; last_date: string }

/** Everything the test cards need beyond the tests themselves. User's client: RLS applies. */
export async function testBoardData(supabase: Db, clientId: string, tests: SprintTest[], opts: { currency: string; targets: Targets }) {
  const pageIds = tests.map((t) => t.notion_page_id).filter(Boolean) as string[]
  const today = londonToday()
  const [{ data: pages }, { data: campaigns }, results] = await Promise.all([
    pageIds.length
      ? supabase.from("notion_pages_mirror").select("notion_page_id, url, properties").in("notion_page_id", pageIds)
      : Promise.resolve({ data: [] as { notion_page_id: string; url: string; properties: Record<string, unknown> }[] }),
    supabase.rpc("client_campaigns", { p_client: clientId, p_from: addDays(today, -30) }),
    Promise.all(
      tests
        // Campaigns belong to one platform, so a test without one has no campaign numbers.
        .flatMap((t) => (t.live_on && t.platform && t.campaign_ids.length ? [{ ...t, live_on: t.live_on, platform: t.platform }] : []))
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

  // Live and review tests with campaigns: the full results for the card's verdict and the side panel.
  const measured = tests.filter((t) => t.live_on && t.campaign_ids.length && !t.outcome && (t.status === "live" || t.status === "review"))
  const detailList = await Promise.all(measured.map(async (t) => [t.id, await loadTestDetail(supabase, clientId, t, { today, ...opts })] as const))
  const details: Record<string, TestDetail> = {}
  for (const [id, d] of detailList) if (d) details[id] = d
  const previewAds = Object.values(details).flatMap((d) => [...d.testAds, ...d.otherAds.slice(0, 10)])
  const previews: PreviewMap = previewAds.length ? await previewsFor(supabase, clientId, previewAds) : {}

  const briefs: Record<string, BriefInfo> = {}
  for (const p of pages ?? []) {
    const props = p.properties as Record<string, unknown>
    const links: BriefInfo["links"] = []
    for (const label of LINK_PROPS) {
      const v = props[label]
      for (const item of Array.isArray(v) ? v : v ? [v] : []) {
        const s = String(item)
        // Notion URL properties are free text: only a well-formed http(s) link becomes a link.
        const web = /^https?:\/\/[^\s]+$/i.test(s) && URL.canParse(s)
        links.push({ label, href: web ? s : null, text: web ? hostOf(s) : s })
      }
    }
    briefs[p.notion_page_id] = { status: (props["Master Status"] as string) ?? null, paid: (props["Status Paid"] as string) ?? null, url: p.url ?? notionPageUrl(p.notion_page_id), links }
  }

  return {
    briefs,
    results: Object.fromEntries(results) as Record<string, TestTotals>,
    details,
    previews,
    campaigns: ((campaigns ?? []) as Record<string, unknown>[]).map((c) => ({
      platform: c.platform as Platform,
      campaign_id: c.campaign_id as string,
      campaign_name: (c.campaign_name as string) ?? (c.campaign_id as string),
      spend: Number(c.spend) || 0,
      last_date: c.last_date as string,
    })) as Campaign[],
  }
}
