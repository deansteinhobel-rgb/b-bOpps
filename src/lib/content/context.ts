import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { briefForPrompt } from "@/lib/knowledge/brief"
import { addDays } from "@/lib/metrics/ads"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { PAID_PRODUCTION_TYPES, PROP } from "@/lib/notion/config"
import { adKey } from "@/lib/previews"
import { rpcAll } from "@/lib/supabase/rpc-all"

/**
 * What Claude reads for content ideas (Dean, 2026-09-29): every campaign of the last 90 days with who
 * it reached (LinkedIn job titles, seniority, functions, industries; Meta age and placement; Google's
 * converting search terms), every ad's numbers, the images of the ads that matter most (so Claude sees
 * the creative, not just its name), the client brief (ICP, must-knows), past sprint tests, the
 * content already in production in Notion, and what the team said about earlier ideas.
 */

const DAYS = 90
const IMAGES = 16
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const num = (v: unknown) => Number(v ?? 0)
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(2)}%` : "–")
const r1 = (v: number) => Math.round(v * 10) / 10

type Totals = { spend: number; impressions: number; clicks: number; results: number }
const add = (t: Totals, r: Record<string, unknown>) => {
  t.spend += num(r.spend)
  t.impressions += num(r.impressions)
  t.clicks += num(r.clicks)
  t.results += num(r.conversions) + num(r.leads)
}
const zero = (): Totals => ({ spend: 0, impressions: 0, clicks: 0, results: 0 })

export type ContentContext = { blocks: Anthropic.ContentBlockParam[]; campaignNames: string[]; adNames: Record<string, string>; clientName: string; currency: string }

export async function buildContentContext(db: SupabaseClient, clientId: string): Promise<ContentContext> {
  const { data: client } = await db.from("clients").select("name, currency, monthly_kpi_target").eq("id", clientId).single()
  if (!client) throw new Error("Client not found.")
  const cur = client.currency as string
  const money = (v: number | null) => (v === null ? "–" : new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(v))
  const cpr = (t: Totals) => (t.results > 0 ? money(t.spend / t.results) : "no results")

  const { data: range } = await db.from("account_data_range").select("platform, data_through").eq("client_id", clientId)
  const to = (range ?? []).map((r) => r.data_through as string).sort().at(-1)
  if (!to) throw new Error("No ad data for this client yet.")
  const from = addDays(to, -(DAYS - 1))
  const from30 = addDays(to, -29)

  const [daily, ads, ads30, statuses, creatives, liDate] = await Promise.all([
    rpcAll(db, "campaign_daily", { p_client: clientId, p_from: from, p_to: to }),
    rpcAll(db, "ad_totals", { p_client: clientId, p_from: from, p_to: to }),
    rpcAll(db, "ad_totals", { p_client: clientId, p_from: from30, p_to: to }),
    db.from("campaign_statuses").select("platform, campaign_id, status").eq("client_id", clientId),
    db.from("ad_creatives").select("platform, external_account_id, ad_id, ad_type, storage_path, content_type, text_ad").eq("client_id", clientId),
    db.from("windsor_breakdowns").select("date").eq("client_id", clientId).like("kind", "li_%").order("date", { ascending: false }).limit(1).maybeSingle(),
  ])

  // Campaigns: 90 days and the last 30.
  const camps = new Map<string, { platform: Platform; id: string; name: string; all: Totals; last30: Totals; first: string; last: string }>()
  for (const r of daily) {
    const k = `${r.platform}|${r.campaign_id}`
    const c = camps.get(k) ?? { platform: r.platform as Platform, id: String(r.campaign_id), name: String(r.campaign_name ?? r.campaign_id), all: zero(), last30: zero(), first: String(r.date), last: String(r.date) }
    add(c.all, r)
    if (String(r.date) >= from30) add(c.last30, r)
    if (num(r.spend) > 0) {
      if (String(r.date) < c.first) c.first = String(r.date)
      if (String(r.date) > c.last) c.last = String(r.date)
    }
    camps.set(k, c)
  }
  const status = new Map((statuses.data ?? []).map((s) => [`${s.platform}|${s.campaign_id}`, s.status as string]))
  const campaigns = [...camps.values()].filter((c) => c.all.spend > 0).sort((a, b) => b.all.spend - a.all.spend).slice(0, 60)

  // Who each campaign reached.
  const kinds = async (kind: string, f: string, t: string) => rpcAll(db, "breakdown_totals", { p_client: clientId, p_kind: kind, p_from: f, p_to: t })
  const li = liDate.data?.date as string | undefined
  const [liTitles, liSeniority, liFunctions, liIndustries, metaAge, metaPlacement, searchTerms] = await Promise.all([
    li ? kinds("li_job_title", li, li) : [],
    li ? kinds("li_seniority", li, li) : [],
    li ? kinds("li_job_function", li, li) : [],
    li ? kinds("li_industry", li, li) : [],
    kinds("meta_age_gender", from, to),
    kinds("meta_placement", from, to),
    kinds("search_term", from, to),
  ])
  const audience = (rows: Record<string, unknown>[], campaignId: string, n: number, label: (r: Record<string, unknown>) => string) => {
    const mine = rows.filter((r) => String(r.campaign_id) === campaignId)
    const total = mine.reduce((s, r) => s + num(r.impressions), 0)
    return mine
      .sort((a, b) => num(b.impressions) - num(a.impressions))
      .slice(0, n)
      .map((r) => `${label(r)} ${total ? Math.round((num(r.impressions) / total) * 100) : 0}%${num(r.clicks) ? ` (${num(r.clicks)} clicks${num(r.leads) + num(r.conversions) ? `, ${r1(num(r.leads) + num(r.conversions))} results` : ""})` : ""}`)
      .join("; ")
  }
  const terms = (campaignId: string) => {
    const mine = searchTerms.filter((r) => String(r.campaign_id) === campaignId)
    const byTerm = new Map<string, Totals>()
    for (const r of mine) {
      const t = byTerm.get(String(r.dim1)) ?? zero()
      add(t, r)
      byTerm.set(String(r.dim1), t)
    }
    return [...byTerm]
      .sort((a, b) => b[1].results - a[1].results || b[1].clicks - a[1].clicks)
      .slice(0, 8)
      .map(([t, v]) => `"${t}" ${r1(v.results)} results / ${v.clicks} clicks`)
      .join("; ")
  }
  const dim = (r: Record<string, unknown>) => String(r.dim1)
  const campaignLines = campaigns.map((c) => {
    const parts = [
      `### ${PLATFORM_LABEL[c.platform]} | ${c.name}`,
      `status ${status.get(`${c.platform}|${c.id}`) ?? "unknown"} · spend from ${c.first} to ${c.last}`,
      `90 days: ${money(c.all.spend)} spend, ${c.all.impressions} impressions, CTR ${pct(c.all.clicks, c.all.impressions)}, ${r1(c.all.results)} results, cost per result ${cpr(c.all)}`,
      `last 30 days: ${money(c.last30.spend)} spend, CTR ${pct(c.last30.clicks, c.last30.impressions)}, ${r1(c.last30.results)} results, cost per result ${cpr(c.last30)}`,
    ]
    if (c.platform === "linkedin" && li) {
      const t = audience(liTitles, c.id, 10, dim)
      if (t) parts.push(`audience (LinkedIn, 30 days to ${li}): job titles ${t}`)
      const s = audience(liSeniority, c.id, 5, dim)
      if (s) parts.push(`seniority ${s}`)
      const f = audience(liFunctions, c.id, 5, dim)
      if (f) parts.push(`functions ${f}`)
      const i = audience(liIndustries, c.id, 6, dim)
      if (i) parts.push(`industries ${i}`)
    }
    if (c.platform === "meta") {
      const a = audience(metaAge, c.id, 6, (r) => `${r.dim1} ${r.dim2 ?? ""}`.trim())
      if (a) parts.push(`audience (Meta): age/gender ${a}`)
      const p = audience(metaPlacement, c.id, 5, (r) => `${r.dim1} ${r.dim2 ?? ""}`.trim())
      if (p) parts.push(`placements ${p}`)
    }
    if (c.platform === "google_ads") {
      const t = terms(c.id)
      if (t) parts.push(`what people searched (top terms): ${t}`)
    }
    return parts.join("\n")
  })

  // Ads: 90 days and 30, with type and (for search ads) the copy.
  const creative = new Map((creatives.data ?? []).map((c) => [adKey(c), c]))
  const recent = new Map(ads30.map((a) => [adKey({ platform: String(a.platform), external_account_id: String(a.external_account_id), ad_id: String(a.ad_id) }), a]))
  const adList = ads
    .map((a) => {
      const key = adKey({ platform: String(a.platform), external_account_id: String(a.external_account_id), ad_id: String(a.ad_id) })
      const t = zero()
      add(t, a)
      const r = recent.get(key)
      const t30 = zero()
      if (r) add(t30, r)
      return { key, a, t, t30, c: creative.get(key) }
    })
    .filter((x) => x.t.spend > 0)
    .sort((x, y) => y.t.results - x.t.results || y.t.spend - x.t.spend)
  const shownAds = adList.slice(0, 120)
  const textAd = (v: unknown) => {
    const t = v as { headlines?: { text: string }[]; descriptions?: { text: string }[] } | null
    return t?.headlines?.length ? ` | copy: ${t.headlines.map((h) => h.text).slice(0, 6).join(" / ")} — ${(t.descriptions ?? []).map((d) => d.text).slice(0, 2).join(" / ")}` : ""
  }
  const adLines = shownAds.map(
    ({ key, a, t, t30, c }) =>
      `- [${key}] ${PLATFORM_LABEL[a.platform as Platform]} | ${a.ad_name ?? a.ad_id} | campaign: ${a.campaign_name ?? "–"} | type: ${c?.ad_type ?? "–"} | 90d: ${money(t.spend)}, CTR ${pct(t.clicks, t.impressions)}, ${r1(t.results)} results, ${cpr(t)} each | 30d: ${money(t30.spend)}, ${r1(t30.results)} results${textAd(c?.text_ad)}`,
  )

  // The creatives Claude looks at: the best by results, plus the biggest spenders without results.
  const withImage = adList.filter((x) => x.c?.storage_path && IMAGE_TYPES.includes(String(x.c.content_type)))
  const picks = [...withImage.filter((x) => x.t.results > 0).slice(0, Math.ceil(IMAGES * 0.65)), ...withImage.filter((x) => x.t.results === 0).sort((a, b) => b.t.spend - a.t.spend).slice(0, Math.floor(IMAGES * 0.35))]
  const images: Anthropic.ContentBlockParam[] = []
  for (const x of picks) {
    const { data: blob } = await db.storage.from("ad-previews").download(x.c!.storage_path as string)
    if (!blob || blob.size > 4_500_000) continue
    images.push({ type: "text", text: `Ad image [${x.key}]: "${x.a.ad_name ?? x.a.ad_id}" (${x.a.campaign_name ?? "–"}; ${r1(x.t.results)} results, ${cpr(x.t)} each, CTR ${pct(x.t.clicks, x.t.impressions)})` })
    images.push({ type: "image", source: { type: "base64", media_type: x.c!.content_type as "image/jpeg", data: Buffer.from(await blob.arrayBuffer()).toString("base64") } })
  }

  // Past tests, content in production (Notion mirror, read only), and what the team said about earlier ideas.
  const [{ data: tests }, { data: mirror }, { data: actions }] = await Promise.all([
    db.from("sprint_tests").select("title, platform, outcome, status, findings_worked, findings_blockers, findings_notes, sprints(number)").eq("client_id", clientId).order("created_at", { ascending: false }).limit(60),
    db.from("notion_pages_mirror").select("title, properties, last_edited_time").eq("client_id", clientId).eq("page_type", "brief").eq("in_trash", false).order("last_edited_time", { ascending: false }).limit(200),
    db.from("content_idea_actions").select("idea_id, action, reason, snapshot, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(60),
  ])
  const text = (v: unknown) => (typeof v === "string" ? v : "")
  const briefs = (mirror ?? [])
    .map((m) => ({ title: m.title ?? "", type: text(m.properties?.[PROP.productionType]), status: text(m.properties?.[PROP.status]), paid: text(m.properties?.[PROP.statusPaid]), desc: text(m.properties?.[PROP.description]) }))
    .filter((b) => PAID_PRODUCTION_TYPES.includes(b.type) || !["", "N/A"].includes(b.paid))
    .slice(0, 50)

  const lines = [
    `# Client: ${client.name}`,
    `Currency ${cur}. Target cost per result: ${client.monthly_kpi_target ? money(Number(client.monthly_kpi_target)) : "not set"}. Result = conversions + leads. Data ${from} to ${to}. Platforms: ${[...new Set(campaigns.map((c) => PLATFORM_LABEL[c.platform]))].join(", ")}.`,
    await briefForPrompt(clientId),
    `\n## Campaigns in the last ${DAYS} days, biggest spend first (names often encode the offer, the audience, the targeting and the format)`,
    ...campaignLines,
    `\n## Ads in the last ${DAYS} days, most results first ([key] platform | ad name or headline | campaign | ad type | numbers)`,
    ...adLines,
    adList.length > shownAds.length ? `(${adList.length - shownAds.length} smaller ads left out)` : "",
    `\n## Sprint tests so far (sprint | title | platform | outcome | findings)`,
    ...((tests ?? []).length
      ? (tests ?? []).map((t) => `- ${(t.sprints as unknown as { number: number } | null)?.number ?? "?"} | ${t.title} | ${t.platform ?? "several"} | ${t.outcome ?? t.status}${t.findings_worked ? ` | worked: ${t.findings_worked}` : ""}${t.findings_blockers ? ` | blocker: ${t.findings_blockers}` : ""}${t.findings_notes ? ` | notes: ${t.findings_notes}` : ""}`)
      : ["(none)"]),
    `\n## Paid media briefs in Notion, newest first (title | status | description) — content already made or in production`,
    ...(briefs.length ? briefs.map((b) => `- ${b.title} | ${b.status || "–"} | ${b.desc.replace(/\s+/g, " ").slice(0, 240)}`) : ["(none)"]),
    `\n## What the team said about earlier content ideas (newest first)`,
    ...((actions ?? []).length
      ? (actions ?? []).map((a) => `- ${a.action === "planned" ? "PLANNED as a sprint test" : a.action === "dismissed" ? "NOT FOR US" : "reopened"}: ${(a.snapshot as { title?: string } | null)?.title ?? a.idea_id}${a.reason ? ` — reason: ${a.reason}` : ""}`)
      : ["(none yet)"]),
    `\n## The ad creatives follow as images, each after a line naming it.`,
  ]
  return {
    blocks: [{ type: "text", text: lines.filter(Boolean).join("\n") }, ...images],
    campaignNames: campaigns.map((c) => c.name),
    adNames: Object.fromEntries(adList.map((x) => [x.key, String(x.a.ad_name ?? x.a.ad_id)])),
    clientName: client.name,
    currency: cur,
  }
}
