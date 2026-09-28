import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays, type DailyRow } from "@/lib/metrics/ads"
import { getOverview } from "@/lib/metrics/overview"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"

/**
 * Everything Claude reads about one client, as a compact text brief: weekly numbers per platform
 * (12 weeks), this month's pacing, top campaigns, ad fatigue, every past test with its outcome and
 * findings, this sprint's plan, logged changes, and earlier suggestions we approved or rejected.
 * Aggregates only, no raw rows. Uses the admin client: call only after checking access.
 */
export async function buildSprintContext(db: SupabaseClient, clientId: string, sprintId: string) {
  const [{ data: client }, { data: sprint }, overview] = await Promise.all([
    db.from("clients").select("name, currency, monthly_kpi_target, main_kpi").eq("id", clientId).single(),
    db.from("sprints").select("number, start_date, end_date").eq("id", sprintId).single(),
    getOverview(db, clientId),
  ])
  if (!client || !sprint) throw new Error("Client or sprint not found")
  const cur = client.currency as string
  const m = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${cur} ${Math.round(v).toLocaleString("en-GB")}`)
  const pct = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(d)}%`)

  const lines: string[] = []
  lines.push(`# Client: ${client.name}`)
  lines.push(`Currency ${cur}. Main KPI: cost per result (spend / (conversions + leads)). Target: ${m(client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target))} per result.`)
  lines.push(`Connected platforms (via Windsor): ${overview ? [...new Set(overview.pacing.map((p) => PLATFORM_LABEL[p.platform]))].join(", ") : "none yet"}. Google Ads counts conversions; LinkedIn and Meta count conversions + leads.`)
  lines.push(`Sprint being planned: Sprint ${sprint.number}, ${sprint.start_date} to ${sprint.end_date} (two weeks).`)

  if (overview) {
    const through = overview.dataThrough
    const from = addDays(through, -83)
    const { data: dailyRaw } = await db.rpc("platform_daily", { p_client: clientId, p_from: from, p_to: through })
    const daily = ((dailyRaw ?? []) as Record<string, unknown>[]).map((r) => ({
      platform: r.platform as Platform,
      date: r.date as string,
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      conversions: Number(r.conversions ?? 0),
      leads: Number(r.leads ?? 0),
    })) as DailyRow[]
    lines.push(`\n## Weekly performance, last 12 weeks (data through ${through})`)
    lines.push("Week ending | platform | spend | impressions | clicks | CTR | results | cost per result")
    const platforms = [...new Set(daily.map((d) => d.platform))]
    for (const p of platforms) {
      for (let w = 11; w >= 0; w--) {
        const end = addDays(through, -7 * w)
        const start = addDays(end, -6)
        const rows = daily.filter((d) => d.platform === p && d.date >= start && d.date <= end)
        const t = rows.reduce((s, r) => ({ spend: s.spend + r.spend, imp: s.imp + r.impressions, clicks: s.clicks + r.clicks, res: s.res + r.conversions + r.leads }), { spend: 0, imp: 0, clicks: 0, res: 0 })
        if (!t.spend && !t.imp) continue
        lines.push(`${end} | ${PLATFORM_LABEL[p]} | ${m(t.spend)} | ${t.imp} | ${t.clicks} | ${pct(t.imp ? t.clicks / t.imp : null)} | ${t.res.toFixed(1)} | ${m(t.res ? t.spend / t.res : null)}`)
      }
    }

    lines.push(`\n## Budget pacing this month (${overview.month.slice(0, 7)})`)
    for (const p of overview.pacing) {
      lines.push(`- ${PLATFORM_LABEL[p.platform]}: spent ${m(p.spendMtd)} of ${m(p.budget)} (${p.ratio === null ? "no budget" : `${Math.round(p.ratio * 100)}% of pace`}).`)
    }

    lines.push("\n## Biggest campaigns this month")
    for (const c of [...overview.campaignPacing].sort((a, b) => b.spendMtd - a.spendMtd).slice(0, 12)) {
      lines.push(`- ${PLATFORM_LABEL[c.platform]} · ${c.campaignName}: ${m(c.spendMtd)}`)
    }

    lines.push("\n## Best and worst ads, last 7 days")
    for (const r of overview.rankings) {
      const d = (a: typeof r.best) => (a ? `"${a.ad_name ?? a.ad_id}" (CTR ${pct(a.ctr)}, cost per result ${m(a.costPerResult)}, spend ${m(a.spend)})` : "–")
      lines.push(`- ${PLATFORM_LABEL[r.platform]} (ranked by ${r.basis === "cost_per_result" ? "cost per result" : "CTR"}): best ${d(r.best)}; worst ${d(r.worst)}`)
    }

    const live = overview.liveAds
    const old = live.filter((a) => a.old)
    lines.push(`\n## Creative fatigue: ${live.length} live ads, ${old.length} first seen over 30 days ago, ${live.filter((a) => a.ctrDown).length} with CTR down vs their first 14 days, ${live.filter((a) => a.cprUp).length} with cost per result up`)
    for (const a of live.filter((x) => x.comparable && (x.ctrDown || x.cprUp)).slice(0, 10)) {
      lines.push(`- ${PLATFORM_LABEL[a.platform]} "${a.ad_name ?? a.ad_id}", ${a.ageDays} days live: CTR ${pct(a.earlyCtr)} → ${pct(a.recentCtr)}, cost per result ${m(a.earlyCpr)} → ${m(a.recentCpr)}, spend last 14d ${m(a.recent_spend)}`)
    }
    const byPlat = (["linkedin", "google_ads", "meta"] as const).map((p) => `${PLATFORM_LABEL[p]} ${overview.newCreatives.filter((a) => a.platform === p).length}`).join(", ")
    lines.push(`New creatives this month: ${byPlat}.`)
  } else {
    lines.push("\nNo Windsor data yet.")
  }

  const [{ data: tests }, { data: changes }, { data: pastRecs }] = await Promise.all([
    db
      .from("sprint_tests")
      .select("title, hypothesis, platform, status, success_metric, success_target, success_text, outcome, findings_worked, findings_blockers, findings_notes, carry_reason, carry_note, campaign_names, live_on, sprint_id, sprints(number, start_date)")
      .eq("client_id", clientId)
      .order("created_at"),
    db.from("sprint_changes").select("changed_on, platform, campaign_name, type, description").eq("client_id", clientId).eq("status", "logged").order("changed_on", { ascending: false }).limit(25),
    db.from("sprint_recommendations").select("title, platform, status, reject_reason").eq("client_id", clientId).in("status", ["approved", "rejected"]).order("decided_at", { ascending: false }).limit(20),
  ])

  const plat = (p: string | null) => (p ? (PLATFORM_LABEL[p as Platform] ?? p) : "Several platforms")
  const past = (tests ?? []).filter((t) => t.sprint_id !== sprintId)
  const now = (tests ?? []).filter((t) => t.sprint_id === sprintId)
  lines.push(`\n## Past tests (${past.length}), oldest first. Sprint 0 = history from before the app.`)
  for (const t of past) {
    const s = t.sprints as unknown as { number: number } | null
    const bits = [
      `Sprint ${s?.number ?? "?"} · ${plat(t.platform)} · "${t.title}"`,
      t.hypothesis && `hypothesis: ${t.hypothesis}`,
      (t.success_text || t.success_target) && `success: ${t.success_text ?? `${t.success_metric} ${t.success_target}`}`,
      `outcome: ${t.outcome ?? t.status}`,
      t.findings_worked && `what worked: ${t.findings_worked}`,
      t.findings_blockers && `blocker: ${t.findings_blockers}`,
      t.findings_notes && `notes: ${t.findings_notes}`,
      t.carry_reason && `carried over (${t.carry_reason}${t.carry_note ? `: ${t.carry_note}` : ""})`,
    ].filter(Boolean)
    lines.push(`- ${bits.join("; ")}`)
  }
  lines.push(`\n## Already planned in this sprint (${now.length}). Don't repeat these.`)
  for (const t of now) lines.push(`- ${plat(t.platform)} · "${t.title}" (${t.status})`)

  if (changes?.length) {
    lines.push("\n## Recent account changes logged by the team")
    for (const c of changes) lines.push(`- ${c.changed_on} · ${plat(c.platform)}${c.campaign_name ? ` · ${c.campaign_name}` : ""}: ${c.description}`)
  }
  if (pastRecs?.length) {
    lines.push("\n## Your earlier suggestions and what the team decided")
    for (const r of pastRecs) lines.push(`- ${r.status.toUpperCase()}: ${plat(r.platform)} · "${r.title}"${r.reject_reason ? `. Reason: ${r.reject_reason}` : ""}`)
  }
  return lines.join("\n")
}
