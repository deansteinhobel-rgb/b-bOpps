import "server-only"
import { rpcAll } from "@/lib/supabase/rpc-all"
import type { Db } from "@/lib/supabase/db"
import type { CompetitorSource } from "./sources"
import { runningSince } from "./keywords"
import type { AdRow } from "./view"

const BUCKET = "ad-previews"

export type CompetitorRow = {
  id: string
  name: string
  website: string | null
  meta_page_id: string | null
  linkedin_advertiser: string | null
  google_advertiser_ids: string[]
  notes: string | null
}
export type OurLabels = { format: string | null; content_type: string | null; offer: string | null; hook: string | null }

/**
 * Everything the Competitor ads page shows, through the caller's client (RLS: the client's team and
 * viewers). Live ads only, with our image copies as signed links (an hour), plus the labels of our
 * own ads that spent in the last 30 days, for "Them vs us".
 */
export async function loadCompetitorPage(supabase: Db, clientId: string, today: string) {
  const monthAgo = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10)
  const [{ data: competitors }, { data: ads }, { data: lastRun }, ours, { data: labels }] = await Promise.all([
    supabase
      .from("client_competitors")
      .select("id, name, website, meta_page_id, linkedin_advertiser, google_advertiser_ids, notes")
      .eq("client_id", clientId)
      .is("removed_at", null)
      .order("name"),
    supabase
      .from("competitor_ads")
      .select(
        "id, competitor_id, source, external_id, started_on, first_seen_at, last_seen_at, active, relevance, countries, format, headline, body, cta, landing_url, library_url, storage_path, label_format, label_content_type, label_offer, label_hook, label_topic, label_summary",
      )
      .eq("client_id", clientId)
      .order("first_seen_at", { ascending: false })
      .limit(3000),
    supabase.from("competitor_runs").select("collected_at").eq("client_id", clientId).eq("status", "collected").order("collected_at", { ascending: false }).limit(1).maybeSingle(),
    rpcAll<{ platform: string; external_account_id: string; ad_id: string; spend: number }>(supabase, "ad_totals", { p_client: clientId, p_from: monthAgo, p_to: today }),
    supabase.from("ad_labels").select("platform, external_account_id, ad_id, format, content_type, offer, hook").eq("client_id", clientId),
  ])
  // A removed competitor's ads stay in the table but leave the page.
  const listed = new Set((competitors ?? []).map((c) => c.id))
  // Stopped versions only date the creative (Meta re-dates edited ads); the page shows live ads.
  const since = runningSince((ads ?? []).filter((a) => listed.has(a.competitor_id)))
  // Off-topic ads (a big company's other products, Claude's check in relevance.ts) leave the page; counted per competitor.
  const offTopic: Record<string, number> = {}
  for (const a of ads ?? []) if (a.active && a.relevance === "off_topic" && listed.has(a.competitor_id)) offTopic[a.competitor_id] = (offTopic[a.competitor_id] ?? 0) + 1
  const rows = (ads ?? [])
    .filter((a) => listed.has(a.competitor_id) && a.active && a.relevance !== "off_topic")
    .map((a) => {
      const first = a.started_on ? since(a).since : null
      return { ...a, started_on: first, version_started_on: a.started_on && first && a.started_on > first ? a.started_on : null }
    })

  const paths = rows.map((a) => a.storage_path).filter(Boolean) as string[]
  const signed = new Map<string, string>()
  for (let i = 0; i < paths.length; i += 500) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 500), 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl)
  }

  const spent = new Set(ours.filter((a) => Number(a.spend) > 0).map((a) => `${a.platform}|${a.external_account_id}|${a.ad_id}`))
  const ourLabels: OurLabels[] = (labels ?? []).filter((l) => spent.has(`${l.platform}|${l.external_account_id}|${l.ad_id}`)).map(({ format, content_type, offer, hook }) => ({ format, content_type, offer, hook }))

  return {
    competitors: (competitors ?? []) as CompetitorRow[],
    offTopic,
    ads: rows.map(({ storage_path, ...a }) => ({ ...a, source: a.source as CompetitorSource, src: storage_path ? (signed.get(storage_path) ?? null) : null })) satisfies AdRow[],
    lastReadAt: lastRun?.collected_at ?? null,
    ourLabels,
  }
}
