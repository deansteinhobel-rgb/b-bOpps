import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { withSymbols } from "@/lib/format"
import { briefForPrompt } from "@/lib/knowledge/brief"
import { addDays } from "@/lib/metrics/ads"
import { campaignBreakdowns } from "@/lib/metrics/breakdowns"
import { cachedInsights } from "@/lib/metrics/cached"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { getInsights } from "./load"
import { RULES, weekOf } from "./rules"

/**
 * Everything "Ask about this campaign" knows about one campaign, as text: 12 weeks of weekly numbers,
 * the last 7 days against the 7 before, its ads, the detail behind it (search terms, audiences,
 * placements), its open insights, Claude's read of its goal, linked sprint tests and the client brief.
 * `db` is the admin client: only call after the user's access to the client was checked.
 */
export async function buildCampaignContext(db: SupabaseClient, clientId: string, platform: Platform, campaignId: string) {
  const { data: client } = await db.from("clients").select("name, currency, monthly_kpi_target").eq("id", clientId).single()
  const { data: range } = await db.from("account_data_range").select("data_through").eq("client_id", clientId).eq("platform", platform)
  const through = (range ?? []).map((r) => r.data_through as string).sort().at(-1)
  if (!client || !through) return null
  const cur = client.currency
  const money = (v: number) => withSymbols(new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", maximumFractionDigits: v < 10 ? 2 : 0 }).format(v))
  const pct = (a: number, b: number, d = 2) => (b > 0 ? `${((a / b) * 100).toFixed(d)}%` : "–")
  const num = (v: unknown) => Number(v ?? 0)

  const from = addDays(weekOf(through), -77) // 12 full weeks, Monday to Sunday
  const [daily, ads, detail, feed, { data: review }, { data: tests }] = await Promise.all([
    rpcAll(db, "campaign_daily", { p_client: clientId, p_from: from, p_to: through }),
    db.rpc("campaign_ads", { p_client: clientId, p_platform: platform, p_campaign_id: campaignId, p_from: addDays(through, -29), p_to: through }),
    campaignBreakdowns(db, clientId, platform, campaignId, addDays(through, -29), through),
    // The shared cache inside Next; computed directly elsewhere (scripts).
    cachedInsights(clientId).catch(() => getInsights(db, clientId)),
    db.from("insight_reviews").select("goals").eq("client_id", clientId).eq("status", "ready").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("sprint_tests").select("title, status, outcome, findings_worked, findings_blockers, live_on, sprints(number)").eq("client_id", clientId).contains("campaign_ids", [campaignId]),
  ])
  const rows = daily.filter((r) => r.platform === platform && String(r.campaign_id) === campaignId)
  if (!rows.length) return null
  const name = String(rows.at(-1)!.campaign_name ?? campaignId)
  type S = { spend: number; impressions: number; clicks: number; results: number }
  const sum = (list: typeof rows): S => list.reduce<S>((s, r) => ({ spend: s.spend + num(r.spend), impressions: s.impressions + num(r.impressions), clicks: s.clicks + num(r.clicks), results: s.results + num(r.conversions) + num(r.leads) }), { spend: 0, impressions: 0, clicks: 0, results: 0 })
  const line = (s: S) => `${money(s.spend)} | ${s.impressions} | ${s.clicks} | ${pct(s.clicks, s.impressions)} | ${s.clicks ? money(s.spend / s.clicks) : "–"} | ${Math.round(s.results * 10) / 10} | ${s.results ? money(s.spend / s.results) : "–"}`

  const weeks = Array.from({ length: 12 }, (_, i) => addDays(from, i * 7))
  const goal = ((review?.goals ?? []) as { platform: string; campaign_id: string; goal: string; note: string }[]).find((g) => g.platform === platform && g.campaign_id === campaignId)
  const insights = (feed?.insights ?? []).filter((i) => i.platform === platform && i.campaignId === campaignId)

  const out = [
    `# ${client.name}: ${PLATFORM_LABEL[platform]} campaign "${name}" (id ${campaignId})`,
    `Target cost per result: ${client.monthly_kpi_target ? money(Number(client.monthly_kpi_target)) : "not set"}. Data to ${through}. Results = conversions + leads.`,
    goal ? `Goal (Claude's daily review, from the name, Notion briefs and client brief): ${goal.goal}. ${goal.note}` : `Goal: read it from the name and the client brief.`,
    `\n## Weekly (week from | spend | impressions | clicks | CTR | CPC | results | cost per result)`,
    ...weeks.map((w) => {
      const days = Math.min(7, Math.round((Date.parse(through) - Date.parse(w)) / 864e5) + 1)
      return `- ${w}${days < 7 ? ` (partial: ${days} day${days === 1 ? "" : "s"} so far)` : ""} | ${line(sum(rows.filter((r) => String(r.date) >= w && String(r.date) <= addDays(w, 6))))}`
    }),
    `\n## Last 7 days vs the 7 before (spend | impressions | clicks | CTR | CPC | results | cost per result)`,
    `- Last 7 (${addDays(through, -6)} to ${through}): ${line(sum(rows.filter((r) => String(r.date) > addDays(through, -7))))}`,
    `- 7 before: ${line(sum(rows.filter((r) => String(r.date) > addDays(through, -14) && String(r.date) <= addDays(through, -7))))}`,
    `\n## Ads, last 30 days (ad | spend | impressions | CTR | results | cost per result | first seen)`,
    ...((ads.data ?? []) as Record<string, unknown>[]).slice(0, 15).map((a) => {
      const s = { spend: num(a.spend), impressions: num(a.impressions), clicks: num(a.clicks), results: num(a.conversions) + num(a.leads) }
      return `- ${String(a.ad_name ?? a.ad_id).slice(0, 120)} | ${money(s.spend)} | ${s.impressions} | ${pct(s.clicks, s.impressions)} | ${Math.round(s.results * 10) / 10} | ${s.results ? money(s.spend / s.results) : "–"} | ${a.first_date}`
    }),
  ]

  // The detail behind the campaign (30 days).
  if (detail.kind === "google") {
    const avg = (k: "share" | "lostBudget" | "lostRank") => {
      const v = detail.share.map((d) => d[k]).filter((x): x is number => x !== null)
      return v.length ? `${Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100)}%` : "–"
    }
    out.push(`\n## Search impression share, 30-day average: won ${avg("share")}, lost to rank ${avg("lostRank")}, lost to budget ${avg("lostBudget")}`)
    out.push(`\n## Top search terms by spend (term | match | spend | clicks | results | already a keyword)`)
    out.push(...detail.terms.slice(0, 25).map((t) => `- ${t.dim1} | ${t.dim2} | ${money(t.m.spend)} | ${t.m.clicks} | ${Math.round(t.m.results * 10) / 10} | ${t.isKeyword ? "yes" : "no"}`))
    const lowQs = detail.keywords.filter((k) => Number(k.extra?.quality_score ?? 10) <= 4).slice(0, 10)
    if (lowQs.length) out.push(`\n## Keywords with quality score 4 or lower`, ...lowQs.map((k) => `- ${k.dim1} (${k.dim2}): QS ${k.extra?.quality_score}, ${money(k.m.spend)}`))
  } else if (detail.kind === "linkedin") {
    for (const [kind, label] of [["li_job_function", "Job functions"], ["li_seniority", "Seniorities"], ["li_industry", "Industries"], ["li_company", "Companies"]] as const) {
      const g = detail.groups[kind]
      if (!g?.rows.length) continue
      out.push(`\n## ${label} reached (30 days to ${g.asOf}; LinkedIn reports no conversions by audience) (value | impressions | clicks | CTR | spend)`)
      out.push(...g.rows.slice(0, 12).map((r) => `- ${r.dim1} | ${r.m.impressions} | ${r.m.clicks} | ${pct(r.m.clicks, r.m.impressions)} | ${money(r.m.spend)}`))
    }
  } else {
    out.push(`\n## Age and gender (value | spend | results | cost per result)`, ...detail.ageGender.slice(0, 12).map((r) => `- ${r.dim1} ${r.dim2} | ${money(r.m.spend)} | ${r.m.results} | ${r.m.results ? money(r.m.spend / r.m.results) : "–"}`))
    out.push(`\n## Placements`, ...detail.placement.slice(0, 10).map((r) => `- ${r.dim1} ${r.dim2} | ${money(r.m.spend)} | ${r.m.results} | CTR ${pct(r.m.clicks, r.m.impressions)}`))
    out.push(`\n## Ad sets (latest day's reach, frequency, learning stage)`, ...detail.adsets.slice(0, 8).map((r) => `- ${r.groupName ?? r.dim1} | ${money(r.m.spend)} | ${r.m.results} results | ${JSON.stringify(r.extra ?? {})}`))
  }

  out.push(`\n## Open "Optimise now" insights for this campaign`, ...(insights.length ? insights.map((i) => `- [${RULES[i.rule].label}] ${withSymbols(i.title)}: ${withSymbols(i.why)}`) : ["(none)"]))
  if (tests?.length) out.push(`\n## Sprint tests in this campaign`, ...tests.map((t) => `- Sprint ${(t.sprints as unknown as { number: number } | null)?.number ?? "?"}: ${t.title} (${t.outcome ?? t.status})${t.findings_worked ? `. Worked: ${t.findings_worked}` : ""}${t.findings_blockers ? `. Blocker: ${t.findings_blockers}` : ""}`))
  out.push(`\n${await briefForPrompt(clientId)}`)
  return { text: out.join("\n"), name, week: weekOf(through), through }
}
