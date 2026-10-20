import "server-only"
import type { Db } from "@/lib/supabase/db"
import { longestRunning, runningSince, topAds, type KeywordAd } from "./keywords"
import type { KeywordSource } from "./sources"

const BUCKET = "ad-previews"
/** Ads seen in the last 14 days are enough for the latest weekly read of every keyword. */
const RECENT_MS = 14 * 86_400_000

export type KeywordRow = { id: string; keyword: string; sources: string[]; created_at: string }
export type KeywordAdView = KeywordAd & {
  /** When the creative started: its earliest version, or when we first saw it (keywords.ts). */
  since: string
  relevance_reason: string | null
  cta: string | null
  landing_url: string | null
  library_url: string | null
  format: string | null
  countries: string[]
  src: string | null
}
export type KeywordSummary = { keywordId: string; source: KeywordSource; count: number; picks: KeywordAdView[] }

/**
 * The Keyword ads page, through the caller's client (RLS: the client's team and viewers): every
 * keyword's 3 longest-running ads per library, and the full top 30 for the one picked. Signed image
 * links (an hour) only for the ads shown.
 */
export async function loadKeywordPage(supabase: Db, client: { id: string; name: string }, pick: { keywordId?: string; source?: KeywordSource }) {
  const since = new Date(Date.now() - RECENT_MS).toISOString()
  const { data: keywords } = await supabase.from("competitor_keywords").select("id, keyword, sources, created_at").eq("client_id", client.id).is("removed_at", null).order("created_at")
  type Raw = Omit<KeywordAdView, "src" | "since"> & { storage_path: string | null }
  const rows: Raw[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("keyword_ads")
      .select("id, keyword_id, source, external_id, advertiser, ranks, started_on, ended_on, first_seen_at, last_seen_at, headline, body, cta, landing_url, library_url, format, countries, storage_path, relevance, relevance_reason")
      .eq("client_id", client.id)
      .gte("last_seen_at", since)
      .order("id")
      .range(from, from + 999)
    rows.push(...(data ?? []).map((r) => ({ ...r, source: r.source as KeywordSource, ranks: (r.ranks ?? {}) as Record<string, number> })))
    if (!data || data.length < 1000) break
  }
  const { data: lastRun } = await supabase
    .from("competitor_runs")
    .select("collected_at")
    .eq("client_id", client.id)
    .not("keyword_id", "is", null)
    .eq("status", "collected")
    .order("collected_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const list = (keywords ?? []) as KeywordRow[]
  const own = [client.name]
  const summaries: { keywordId: string; source: KeywordSource; count: number; top: Raw[]; picks: Raw[] }[] = []
  for (const k of list)
    for (const source of ["linkedin", "meta"] as const) {
      if (!k.sources.includes(source)) continue
      const versions = rows.filter((r) => r.keyword_id === k.id && r.source === source)
      const top = topAds(versions)
      summaries.push({ keywordId: k.id, source, count: top.length, top, picks: longestRunning(top, own, 3, versions) })
    }

  const selected = list.find((k) => k.id === pick.keywordId) ?? list[0] ?? null
  const source: KeywordSource = pick.source && selected?.sources.includes(pick.source) ? pick.source : ((selected?.sources[0] as KeywordSource) ?? "linkedin")
  const selectedTop = summaries.find((s) => s.keywordId === selected?.id && s.source === source)?.top ?? []

  // Sign images for every pick and the selected top 30.
  const shown = new Map<string, Raw>()
  for (const s of summaries) for (const p of s.picks) shown.set(p.id, p)
  for (const a of selectedTop) shown.set(a.id, a)
  const paths = [...shown.values()].map((a) => a.storage_path).filter(Boolean) as string[]
  const signed = new Map<string, string>()
  for (let i = 0; i < paths.length; i += 500) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 500), 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl)
  }
  const creativeSince = runningSince(rows)
  const view = (a: Raw): KeywordAdView => {
    const { storage_path, ...rest } = a
    return { ...rest, since: creativeSince(a).since, src: storage_path ? (signed.get(storage_path) ?? null) : null }
  }

  return {
    keywords: list,
    selected: selected ? { id: selected.id, source } : null,
    top: selectedTop.map(view),
    summaries: summaries.map((s): KeywordSummary => ({ keywordId: s.keywordId, source: s.source, count: s.count, picks: s.picks.map(view) })),
    lastReadAt: lastRun?.collected_at ?? null,
  }
}
