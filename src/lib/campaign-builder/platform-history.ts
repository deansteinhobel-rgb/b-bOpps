import "server-only"
import type { Db } from "@/lib/supabase/db"
import { dataRanges } from "@/lib/metrics/data-range"
import { addDays } from "@/lib/metrics/ads"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { readMetaAccount } from "@/lib/ads-api/meta-account"
import { conversionKey, type MetaConversion } from "@/lib/ads-api/meta-ids"
import { parseMetaTargeting } from "@/lib/windsor/settings-parse"
import type { HistoryCampaign } from "./history"
import { BUILD_PLATFORM_LABEL, type OtherPlatform } from "./platform-plan"

/**
 * A client's history on Google Ads, Meta or Reddit for the campaign builder (Dean, 2026-10-21),
 * like LinkedIn's in history.ts: 90 days of campaigns with their numbers and status, the top ads
 * with their copy and labels, the platform's sprint tests, and per platform what the plan needs:
 * Google's converting search terms that aren't keywords yet, its top keywords and impression share;
 * Meta's ad sets with their audiences and the page and pixel ids the account already uses (the
 * planner may only use these ids); Reddit's campaigns. Microsoft Ads has no data yet.
 */
const DAYS = 90
const num = (v: unknown) => Number(v ?? 0)
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())

/** The Meta ids a plan may use: only what the account's own ad sets already use. */
export type MetaIds = {
  pages: string[]
  pixels: MetaConversion[]
  adSets: { id: string; name: string; campaign: string; spend: number; audience: string }[]
}

export type PlatformHistory = { platform: OtherPlatform; from: string; to: string; campaigns: HistoryCampaign[]; meta: MetaIds | null }

type DbPlatform = "google_ads" | "meta" | "reddit"
const dbPlatform = (p: OtherPlatform): DbPlatform | null => (p === "microsoft_ads" ? null : p)

export async function platformHistory(db: Db, clientId: string, platform: OtherPlatform): Promise<PlatformHistory | null> {
  const p = dbPlatform(platform)
  if (!p) return null
  const { data: range } = await dataRanges(db, clientId)
  const to = (range ?? []).filter((r) => r.platform === p).map((r) => r.data_through as string).sort().at(-1)
  if (!to) return null
  const from = addDays(to, -(DAYS - 1))
  const from30 = addDays(to, -29)
  const [daily, statuses] = await Promise.all([
    rpcAll<Record<string, unknown>>(db, "campaign_daily", { p_client: clientId, p_from: from, p_to: to }),
    db.from("campaign_statuses").select("campaign_id, status, external_account_id").eq("client_id", clientId).eq("platform", p),
  ])
  const status = new Map((statuses.data ?? []).map((s) => [String(s.campaign_id), { status: s.status as string, account: s.external_account_id as string }]))
  const byId = new Map<string, HistoryCampaign>()
  for (const r of daily) {
    if (r.platform !== p) continue
    const id = String(r.campaign_id)
    const c = byId.get(id) ?? { id, accountId: status.get(id)?.account ?? null, name: String(r.campaign_name ?? id), status: status.get(id)?.status ?? null, abx: false, spend: 0, impressions: 0, clicks: 0, results: 0, spend30: 0, results30: 0, lastDay: String(r.date) }
    const results = num(r.conversions) + num(r.leads)
    c.spend += num(r.spend)
    c.impressions += num(r.impressions)
    c.clicks += num(r.clicks)
    c.results += results
    if (String(r.date) >= from30) {
      c.spend30 += num(r.spend)
      c.results30 += results
    }
    if (num(r.spend) > 0 && String(r.date) > c.lastDay) c.lastDay = String(r.date)
    byId.set(id, c)
  }
  const campaigns = [...byId.values()].filter((c) => c.spend > 0).sort((a, b) => b.spend30 - a.spend30 || b.spend - a.spend)
  return { platform, from, to, campaigns, meta:
      p === "meta"
        ? await metaIds(db, clientId, to).catch((e) => {
            console.error("[platform-history] Meta ids", clientId, e)
            return { pages: [], pixels: [], adSets: [] }
          })
        : null }
}

/**
 * The pages, conversions and ad sets the Meta account already uses (Windsor, 30 days, read only;
 * readMetaAccount), each ad set with its audience. Ad set results aren't read: Windsor's Meta
 * connector breaks when an actions field comes with spend, so the campaigns above carry results.
 */
async function metaIds(db: Db, clientId: string, to: string): Promise<MetaIds> {
  const [{ data: accounts }, { data: settings }] = await Promise.all([
    db.from("client_platform_accounts").select("external_account_id, windsor_connector").eq("client_id", clientId).eq("platform", "meta").eq("active", true),
    db.from("platform_settings").select("entity_id, settings").eq("client_id", clientId).eq("platform", "meta").eq("level", "adset"),
  ])
  const audienceOf = new Map((settings ?? []).map((s) => [s.entity_id, s.settings as Record<string, unknown>]))
  const pages: string[] = []
  const pixels = new Map<string, MetaConversion>()
  const adSets: MetaIds["adSets"] = []
  for (const a of accounts ?? []) {
    const read = await readMetaAccount(a.windsor_connector, a.external_account_id, addDays(to, -29), to)
    for (const p of read.pages) if (!pages.includes(p)) pages.push(p)
    for (const c of read.conversions) pixels.set(conversionKey(c), c)
    for (const s of read.adSets) {
      if (s.spend <= 0) continue
      const stored = audienceOf.get(s.id)
      adSets.push({ id: s.id, name: s.name, campaign: s.campaign, spend: s.spend, audience: s.targeting ? audienceSummary(parseMetaTargeting(s.targeting), s.targeting) : stored ? audienceSummary(parseMetaTargeting(null), null, stored) : "not read" })
    }
  }
  return { pages, pixels: [...pixels.values()], adSets: adSets.sort((a, b) => b.spend - a.spend).slice(0, 25) }
}

function audienceSummary(t: ReturnType<typeof parseMetaTargeting>, raw: unknown, stored?: Record<string, unknown>): string {
  let geo = ""
  try {
    const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as { geo_locations?: { countries?: string[] }; age_min?: number; age_max?: number } | null
    if (r?.geo_locations?.countries?.length) geo = r.geo_locations.countries.join(", ")
    if (r?.age_min) geo += ` ${r.age_min}-${r.age_max ?? 65}`
  } catch {
    geo = ""
  }
  const lists = stored ? (stored.matched_audiences as string[] | undefined) ?? [] : t.matched_audiences
  const lookalikes = stored ? (stored.lookalikes as string[] | undefined) ?? [] : t.lookalikes
  const advantage = stored ? stored.advantage_audience : t.advantage_audience
  return [geo.trim(), lists.length ? `lists: ${lists.slice(0, 4).join(", ")}` : "", lookalikes.length ? `lookalikes: ${lookalikes.slice(0, 3).join(", ")}` : "", advantage ? "Advantage+ audience on" : ""].filter(Boolean).join("; ") || "broad"
}

/** The history as text for the planner. */
export async function platformHistoryForPrompt(db: Db, clientId: string, h: PlatformHistory | null, o: { platform: OtherPlatform; money: (n: number) => string; target: number | null }): Promise<string> {
  const label = BUILD_PLATFORM_LABEL[o.platform]
  if (o.platform === "microsoft_ads") return `# Microsoft Ads history\n(No Microsoft data; mirror Google Search.)\n\n${await googleSearchMirror(db, clientId, o.money)}`
  if (!h) return `# ${label} history\n(No ${label} data for this client yet.)`
  const { money } = o
  const p = dbPlatform(o.platform)!
  const cpr = (spend: number, results: number) => (results > 0 ? money(spend / results) : "no results")
  const ctr = (c: { clicks: number; impressions: number }) => (c.impressions ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : "–")
  const line = (c: HistoryCampaign) => `- ${c.name} | ${c.status ?? "status unknown"} | 90d ${money(c.spend)}, ${Math.round(c.results)} results, ${cpr(c.spend, c.results)} each, CTR ${ctr(c)} | 30d ${money(c.spend30)}, ${cpr(c.spend30, c.results30)} each`

  const [ads, { data: labels }, { data: creatives }, { data: tests }] = await Promise.all([
    rpcAll<Record<string, unknown>>(db, "ad_totals", { p_client: clientId, p_from: h.from, p_to: h.to }),
    db.from("ad_labels").select("ad_id, format, offer, hook, summary").eq("client_id", clientId).eq("platform", p),
    db.from("ad_creatives").select("ad_id, text_ad").eq("client_id", clientId).eq("platform", p),
    db.from("sprint_tests").select("title, hypothesis, outcome, findings_worked, findings_blockers, status, lever").eq("client_id", clientId).eq("platform", p).is("archived_at", null).order("created_at", { ascending: false }).limit(12),
  ])
  const labelOf = new Map((labels ?? []).map((l) => [l.ad_id, l]))
  const copyOf = new Map((creatives ?? []).map((c) => [c.ad_id, c.text_ad as { headlines?: { text: string }[]; descriptions?: { text: string }[] } | null]))
  const topAds = ads
    .filter((a) => a.platform === p && a.ad_id && num(a.spend) > 0)
    .map((a) => ({ a, results: num(a.conversions) + num(a.leads) }))
    .sort((x, y) => y.results - x.results || num(y.a.spend) - num(x.a.spend))
    .slice(0, 12)
  const adLine = ({ a, results }: (typeof topAds)[number]) => {
    const l = labelOf.get(String(a.ad_id))
    const t = copyOf.get(String(a.ad_id))
    const copy = t?.headlines?.length ? ` | copy: ${t.headlines.map((x) => x.text).slice(0, 6).join(" / ")} — ${(t.descriptions ?? []).map((x) => x.text).slice(0, 2).join(" / ")}` : ""
    return `- ${a.ad_name ?? a.ad_id} (${a.campaign_name ?? "–"}) | ${money(num(a.spend))}, ${Math.round(results)} results, ${cpr(num(a.spend), results)} each, CTR ${ctr({ clicks: num(a.clicks), impressions: num(a.impressions) })}${l ? ` | ${l.format}, offer ${l.offer}, hook ${l.hook}${l.summary ? `: ${l.summary}` : ""}` : ""}${copy}`
  }

  const extra = o.platform === "google_ads" ? await googleExtras(db, clientId, h, money) : o.platform === "meta" ? metaExtras(h.meta, money) : []

  return [
    `# ${label} history (${h.from} to ${h.to}; target cost per result ${o.target === null ? "not set" : money(o.target)})`,
    `## Campaigns, newest spend first (name | status | 90 days | last 30 days)`,
    ...(h.campaigns.length ? h.campaigns.slice(0, 30).map(line) : ["(none in the last 90 days)"]),
    ``,
    `## Top ads (90 days, by results)`,
    ...(topAds.length ? topAds.map(adLine) : ["(no ad-level data)"]),
    ...extra,
    ``,
    `## ${label} sprint tests (newest first)`,
    ...((tests ?? []).length
      ? (tests ?? []).map((t) => `- ${t.title} [${t.outcome ?? t.status}${t.lever ? `, lever ${t.lever}` : ""}]${t.hypothesis ? ` Hypothesis: ${t.hypothesis}.` : ""}${t.findings_worked ? ` Worked: ${t.findings_worked}.` : ""}${t.findings_blockers ? ` Blocker: ${t.findings_blockers}.` : ""}`)
      : ["(none yet)"]),
  ].join("\n")
}

async function googleExtras(db: Db, clientId: string, h: PlatformHistory, money: (n: number) => string): Promise<string[]> {
  const from30 = addDays(h.to, -29)
  const [terms, keywords, share] = await Promise.all([
    rpcAll<Record<string, unknown>>(db, "search_term_candidates", { p_client: clientId, p_from: from30, p_to: h.to, p_min_spend: 1e12, p_min_results: 1 }),
    rpcAll<Record<string, unknown>>(db, "breakdown_totals", { p_client: clientId, p_kind: "keyword", p_from: from30, p_to: h.to }),
    db.from("windsor_breakdowns").select("campaign_name, extra").eq("client_id", clientId).eq("kind", "impression_share").gte("date", addDays(h.to, -13)).limit(2000),
  ])
  const converting = terms.filter((t) => !t.is_keyword && num(t.results) > 0).sort((a, b) => num(b.results) - num(a.results)).slice(0, 40)
  const kw = new Map<string, { match: string; spend: number; clicks: number; results: number }>()
  for (const k of keywords) {
    const key = `${k.dim1}|${k.dim2}`
    const e = kw.get(key) ?? { match: str(k.dim2), spend: 0, clicks: 0, results: 0 }
    e.spend += num(k.spend)
    e.clicks += num(k.clicks)
    e.results += num(k.conversions) + num(k.leads)
    kw.set(key, e)
  }
  const topKw = [...kw.entries()].sort((a, b) => b[1].results - a[1].results || b[1].spend - a[1].spend).slice(0, 30)
  const isBy = new Map<string, { share: number[]; budget: number[]; rank: number[] }>()
  for (const r of share.data ?? []) {
    const e = (r.extra ?? {}) as Record<string, unknown>
    const c = isBy.get(str(r.campaign_name)) ?? { share: [], budget: [], rank: [] }
    if (e.search_impression_share != null) c.share.push(num(e.search_impression_share))
    if (e.search_budget_lost_impression_share != null) c.budget.push(num(e.search_budget_lost_impression_share))
    if (e.search_rank_lost_impression_share != null) c.rank.push(num(e.search_rank_lost_impression_share))
    isBy.set(str(r.campaign_name), c)
  }
  const avg = (xs: number[]) => (xs.length ? `${Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100)}%` : "–")
  return [
    ``,
    `## Converting search terms that aren't keywords yet (30 days)`,
    ...(converting.length ? converting.map((t) => `- "${t.term}" (${t.campaign_name}) ${Math.round(num(t.results) * 10) / 10} conversions, ${money(num(t.spend))}`) : ["(none)"]),
    ``,
    `## Top keywords (30 days: text | match | conversions | spend)`,
    ...(topKw.length ? topKw.map(([k, e]) => `- ${k.split("|")[0]} | ${e.match || "–"} | ${Math.round(e.results * 10) / 10} | ${money(e.spend)}`) : ["(no keyword data)"]),
    ``,
    `## Search impression share (14 days: share | lost to budget | lost to rank)`,
    ...(isBy.size ? [...isBy.entries()].slice(0, 15).map(([n, c]) => `- ${n}: ${avg(c.share)} | ${avg(c.budget)} | ${avg(c.rank)}`) : ["(no impression share data)"]),
  ]
}

function metaExtras(m: MetaIds | null, money: (n: number) => string): string[] {
  if (!m) return []
  return [
    ``,
    `## Meta ids the account already uses (use ONLY these; never invent an id)`,
    `Facebook pages: ${m.pages.length ? m.pages.join(", ") : "(none found: leave pageId null)"}`,
    `Conversions (pixel, event${m.pixels.some((p) => p.customConversionId) ? ", custom conversion" : ""}): ${m.pixels.length ? m.pixels.map((p) => `${p.pixelId} "${p.event}"${p.customConversionId ? ` (custom conversion ${p.customConversionId})` : ""}`).join("; ") : "(none found)"}`,
    ``,
    `## Ad sets with spend in the last 30 days (id | name | campaign | spend | audience; results are on the campaigns above): baseAdSetId must be one of these ids`,
    ...(m.adSets.length ? m.adSets.map((a) => `- ${a.id} | ${a.name} | ${a.campaign} | ${money(a.spend)} | ${a.audience}`) : ["(none)"]),
  ]
}

/** Microsoft mirrors Google: the client's Google Search campaigns and converting keywords. */
async function googleSearchMirror(db: Db, clientId: string, money: (n: number) => string) {
  const g = await platformHistory(db, clientId, "google_ads")
  if (!g) return "(No Google Ads data either: plan from the brief.)"
  const cpr = (spend: number, results: number) => (results > 0 ? money(spend / results) : "no results")
  return [
    `## Google Ads campaigns to mirror (90 days)`,
    ...g.campaigns.slice(0, 15).map((c) => `- ${c.name} | ${c.status ?? "–"} | ${money(c.spend)}, ${Math.round(c.results)} results, ${cpr(c.spend, c.results)} each`),
    ...(await googleExtras(db, clientId, g, money)),
  ].join("\n")
}
