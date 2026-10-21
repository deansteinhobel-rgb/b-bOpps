import "server-only"
import type { Db } from "@/lib/supabase/db"
import { dataRanges } from "@/lib/metrics/data-range"
import { addDays } from "@/lib/metrics/ads"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { isAbxCampaign, type BuilderMode } from "./presets"

/**
 * A client's LinkedIn history for the campaign builder (Dean, 2026-10-21): every campaign of the
 * last 90 days with its numbers and status, who LinkedIn says the ads reached, which formats and
 * offers worked (from the ad labels), and the LinkedIn sprint tests with their outcome. The page
 * uses the campaign list for the General and ABX views; the planner reads the text.
 */
const DAYS = 90
const num = (v: unknown) => Number(v ?? 0)

export type HistoryCampaign = {
  id: string
  accountId: string | null
  name: string
  status: string | null
  abx: boolean
  spend: number
  impressions: number
  clicks: number
  results: number
  spend30: number
  results30: number
  lastDay: string
}

export type LinkedInHistory = { from: string; to: string; campaigns: HistoryCampaign[] }

export async function linkedInHistory(db: Db, clientId: string, abxSegments: (name: string) => boolean = isAbxCampaign): Promise<LinkedInHistory | null> {
  const { data: range } = await dataRanges(db, clientId)
  const to = (range ?? []).filter((r) => r.platform === "linkedin").map((r) => r.data_through as string).sort().at(-1)
  if (!to) return null
  const from = addDays(to, -(DAYS - 1))
  const from30 = addDays(to, -29)
  const [daily, statuses] = await Promise.all([
    rpcAll<Record<string, unknown>>(db, "campaign_daily", { p_client: clientId, p_from: from, p_to: to }),
    db.from("campaign_statuses").select("campaign_id, status, external_account_id").eq("client_id", clientId).eq("platform", "linkedin"),
  ])
  // The daily Windsor sync keeps each campaign's status and account.
  const status = new Map((statuses.data ?? []).map((s) => [String(s.campaign_id), { status: s.status as string, account: s.external_account_id as string }]))
  const byId = new Map<string, HistoryCampaign>()
  for (const r of daily) {
    if (r.platform !== "linkedin") continue
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
  const campaigns = [...byId.values()].filter((c) => c.spend > 0).map((c) => ({ ...c, abx: abxSegments(c.name) })).sort((a, b) => b.spend30 - a.spend30 || b.spend - a.spend)
  return { from, to, campaigns }
}

/** The history as text for the planner, the view's own campaigns first. */
export async function historyForPrompt(db: Db, clientId: string, h: LinkedInHistory | null, o: { mode: BuilderMode; money: (n: number) => string; target: number | null }): Promise<string> {
  if (!h) return "# LinkedIn history\n(No LinkedIn data for this client yet.)"
  const { money } = o
  const cpr = (spend: number, results: number) => (results > 0 ? money(spend / results) : "no results")
  const ctr = (c: HistoryCampaign) => (c.impressions ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : "–")
  const line = (c: HistoryCampaign) => `- ${c.name} | ${c.status ?? "status unknown"} | 90d ${money(c.spend)}, ${Math.round(c.results)} results, ${cpr(c.spend, c.results)} each, CTR ${ctr(c)} | 30d ${money(c.spend30)}, ${cpr(c.spend30, c.results30)} each`
  const mine = h.campaigns.filter((c) => c.abx === (o.mode === "abx"))
  const rest = h.campaigns.filter((c) => c.abx !== (o.mode === "abx"))

  // Who the ads reached (LinkedIn's latest 30-day snapshot), across campaigns.
  const { data: snap } = await db.from("windsor_breakdowns").select("date").eq("client_id", clientId).like("kind", "li_%").order("date", { ascending: false }).limit(1).maybeSingle()
  const audienceLines: string[] = []
  if (snap?.date) {
    for (const [kind, label] of [["li_job_title", "Job titles"], ["li_seniority", "Seniorities"], ["li_job_function", "Job functions"], ["li_industry", "Industries"]] as const) {
      const rows = await rpcAll<Record<string, unknown>>(db, "breakdown_totals", { p_client: clientId, p_kind: kind, p_from: snap.date, p_to: snap.date })
      const by = new Map<string, { imp: number; clicks: number; results: number }>()
      for (const r of rows) {
        const e = by.get(String(r.dim1)) ?? { imp: 0, clicks: 0, results: 0 }
        e.imp += num(r.impressions)
        e.clicks += num(r.clicks)
        e.results += num(r.conversions) + num(r.leads)
        by.set(String(r.dim1), e)
      }
      const top = [...by.entries()].sort((a, b) => b[1].imp - a[1].imp).slice(0, 12)
      if (top.length) audienceLines.push(`${label}: ${top.map(([n, e]) => `${n} (${e.imp ? ((e.clicks / e.imp) * 100).toFixed(2) : "0"}% CTR${e.results ? `, ${Math.round(e.results)} results` : ""})`).join("; ")}`)
    }
  }

  // Which formats and offers worked, from the ad labels (last 90 days).
  const [{ data: labels }, ads] = await Promise.all([
    db.from("ad_labels").select("ad_id, format, offer, hook, content_type").eq("client_id", clientId).eq("platform", "linkedin"),
    rpcAll<Record<string, unknown>>(db, "ad_totals", { p_client: clientId, p_from: h.from, p_to: h.to }),
  ])
  const label = new Map((labels ?? []).map((l) => [l.ad_id, l]))
  const byFormat = new Map<string, { spend: number; results: number; ads: number }>()
  const byOffer = new Map<string, { spend: number; results: number; ads: number }>()
  for (const a of ads) {
    if (a.platform !== "linkedin" || !a.ad_id) continue
    const l = label.get(String(a.ad_id))
    if (!l) continue
    for (const [map, key] of [[byFormat, l.format], [byOffer, l.offer]] as const) {
      const e = map.get(key) ?? { spend: 0, results: 0, ads: 0 }
      e.spend += num(a.spend)
      e.results += num(a.conversions) + num(a.leads)
      e.ads += 1
      map.set(key, e)
    }
  }
  const mix = (m: Map<string, { spend: number; results: number; ads: number }>) =>
    [...m.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, 8).map(([k, e]) => `${k}: ${e.ads} ads, ${money(e.spend)}, ${cpr(e.spend, e.results)} per result`).join("; ")

  const { data: tests } = await db
    .from("sprint_tests")
    .select("title, hypothesis, outcome, findings_worked, findings_blockers, success_text, status, lever")
    .eq("client_id", clientId)
    .eq("platform", "linkedin")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(15)

  return [
    `# LinkedIn history (${h.from} to ${h.to}; target cost per result ${o.target === null ? "not set" : money(o.target)})`,
    `## ${o.mode === "abx" ? "Account-based (ABX) campaigns" : "General campaigns"}, newest spend first (name | status | 90 days | last 30 days)`,
    ...(mine.length ? mine.slice(0, 30).map(line) : ["(none in the last 90 days)"]),
    `## ${o.mode === "abx" ? "General" : "Account-based (ABX)"} campaigns`,
    ...(rest.length ? rest.slice(0, 15).map(line) : ["(none)"]),
    ``,
    `## Who the ads reached (LinkedIn's 30-day snapshot to ${snap?.date ?? "–"})`,
    ...(audienceLines.length ? audienceLines : ["(no audience data yet)"]),
    ``,
    `## Formats and offers (labeled ads, 90 days)`,
    byFormat.size ? `Formats: ${mix(byFormat)}` : "(no labeled ads)",
    byOffer.size ? `Offers: ${mix(byOffer)}` : "",
    ``,
    `## LinkedIn sprint tests (newest first)`,
    ...((tests ?? []).length
      ? (tests ?? []).map((t) => `- ${t.title} [${t.outcome ?? t.status}${t.lever ? `, lever ${t.lever}` : ""}]${t.hypothesis ? ` Hypothesis: ${t.hypothesis}.` : ""}${t.findings_worked ? ` Worked: ${t.findings_worked}.` : ""}${t.findings_blockers ? ` Blocker: ${t.findings_blockers}.` : ""}`)
      : ["(none yet)"]),
  ].join("\n")
}
