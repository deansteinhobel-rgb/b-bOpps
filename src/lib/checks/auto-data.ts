/**
 * The numbers pre-loaded above each check's status picker, built from the Windsor cache.
 * Saved into check_results.auto_data when the check is saved, so the record shows what the
 * checker saw. Checks with no Windsor equivalent return null.
 */
import { money, oneDp, percent, whole } from "@/lib/format"
import { addDays, totals } from "@/lib/metrics/ads"
import type { Overview } from "@/lib/metrics/overview"

const keyOf = (a: { platform: string; external_account_id: string; ad_id: string }) => `${a.platform}|${a.external_account_id}|${a.ad_id}`
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"

export type AutoData = {
  dataThrough: string
  note?: string
  table?: { columns: string[]; rows: (string | number)[][] }
  /** Per table row: the ad's preview key (platform|account|ad_id), resolved to an image when shown. */
  adKeys?: (string | null)[]
  facts?: { label: string; value: string; status?: "green" | "amber" | "red" | "no_budget" }[]
}

const platforms = (o: Overview) => o.pacing.map((p) => p.platform)

export function buildAutoData(key: string, o: Overview, ctx: { currency: string; target: number | null; weekStart: string }): AutoData | null {
  const cur = ctx.currency
  const base = { dataThrough: o.dataThrough }
  const last7 = (p: Platform) => totals(o.daily, addDays(o.dataThrough, -6), o.dataThrough, p)

  switch (key) {
    case "leads_in_crm":
      return {
        ...base,
        note: "Platform-reported, last 7 days. Compare with HubSpot (HubSpot counts come in a later phase).",
        table: {
          columns: ["Platform", "Conversions", "Leads", "Total"],
          rows: platforms(o).map((p) => {
            const t = last7(p)
            return [PLATFORM_LABEL[p], oneDp(t.conversions), oneDp(t.leads), oneDp(t.results)]
          }),
        },
      }

    case "budget_pacing":
      return {
        ...base,
        table: {
          columns: ["Platform", "Status", "Spent MTD", "Expected", "Budget", "Pace"],
          rows: o.pacing.map((p) => [
            PLATFORM_LABEL[p.platform],
            p.status === "no_budget" ? "No budget" : `rag:${p.status}`,
            money(p.spendMtd, cur),
            p.budget ? money(p.expected, cur) : "–",
            money(p.budget, cur),
            p.ratio === null ? "–" : `${Math.round(p.ratio * 100)}%`,
          ]),
        },
        facts: o.pacing.filter((p) => p.reasons.length).map((p) => ({ label: PLATFORM_LABEL[p.platform], value: p.reasons.join("; "), status: p.status })),
      }

    case "ad_fatigue":
      return {
        ...base,
        note: `${o.fatigued.length} live ads first seen 45+ days ago. Age counts from the first day with impressions in our data (from ${o.dataFrom}), because Windsor can't see creative edits.`,
        table: {
          columns: ["Ad", "Platform", "Age", "Spend 7d", "CTR 7d", "CTR first 14d"],
          rows: o.fatigued.slice(0, 10).map((a) => [
            a.ad_name ?? a.ad_id,
            PLATFORM_LABEL[a.platform],
            `${a.ageDays}${a.firstSeenCapped ? "+" : ""} days`,
            money(a.recent_spend, cur),
            percent(a.recentCtr, 2),
            a.firstSeenCapped ? "–" : percent(a.earlyCtr, 2),
          ]),
        },
        adKeys: o.fatigued.slice(0, 10).map(keyOf),
      }

    case "naming_spot_check": {
      // New since the start of last week (the week this check reviews), across month boundaries.
      const since = addDays(ctx.weekStart, -7)
      const thisWeek = o.adLifetimes.filter((a) => a.first_seen >= since && a.first_seen > a.data_from).sort((a, b) => b.first_seen.localeCompare(a.first_seen))
      return {
        ...base,
        note: `${thisWeek.length} ads first seen since ${since}. Check five against the naming convention.`,
        table: {
          columns: ["Platform", "Campaign", "Ad", "First seen"],
          rows: thisWeek.slice(0, 15).map((a) => [PLATFORM_LABEL[a.platform], a.campaign_name ?? "", a.ad_name ?? a.ad_id, a.first_seen]),
        },
        adKeys: thisWeek.slice(0, 15).map(keyOf),
      }
    }

    case "best_ad":
    case "worst_ad": {
      const which = key === "best_ad" ? "best" : "worst"
      return {
        ...base,
        note: "Last 7 days. Only ads above their account's median spend; by cost per result when 2+ ads have 3+ results, else by CTR.",
        table: {
          columns: ["Platform", "Ad", "Campaign", "Spend", "Results", "Cost/result", "CTR"],
          rows: o.rankings.map((r) => {
            const a = r[which]
            return a
              ? [PLATFORM_LABEL[r.platform], a.ad_name ?? a.ad_id, a.campaign_name ?? "", money(a.spend, cur), oneDp(a.results), money(a.costPerResult, cur), percent(a.ctr, 2)]
              : [PLATFORM_LABEL[r.platform], "Not enough eligible ads", "", "", "", "", ""]
          }),
        },
        adKeys: o.rankings.map((r) => (r[which] ? keyOf(r[which]!) : null)),
      }
    }

    case "google_search_terms":
    case "linkedin_audience": {
      const p: Platform = key === "google_search_terms" ? "google_ads" : "linkedin"
      if (!platforms(o).includes(p)) return { ...base, note: `No ${PLATFORM_LABEL[p]} account for this client.` }
      const t = last7(p)
      return {
        ...base,
        note: `${PLATFORM_LABEL[p]}, last 7 days.`,
        facts: [
          { label: "Spend", value: money(t.spend, cur) },
          { label: "Impressions", value: whole(t.impressions) },
          { label: "Clicks", value: whole(t.clicks) },
          { label: "CTR", value: percent(t.ctr, 2) },
          { label: "Results", value: oneDp(t.results) },
          { label: "Cost per result", value: money(t.costPerResult, cur) },
        ],
      }
    }

    case "new_creatives":
      return {
        ...base,
        note: `Ads first seen in ${o.dataThrough.slice(0, 7)}.`,
        table: {
          columns: ["Platform", "New ads", "Still live"],
          rows: platforms(o).map((p) => {
            const list = o.newCreatives.filter((a) => a.platform === p)
            return [PLATFORM_LABEL[p], list.length, list.filter((a) => a.live).length]
          }),
        },
      }

    case "kpi_vs_target": {
      const monthStart = o.dataThrough.slice(0, 8) + "01"
      const prevEnd = addDays(monthStart, -1)
      const prevStart = prevEnd.slice(0, 8) + "01"
      const status = (cpr: number | null) =>
        ctx.target === null || cpr === null ? undefined : cpr <= ctx.target ? "green" : cpr <= ctx.target * 1.2 ? "amber" : "red"
      const row = (label: string, p?: Platform) => {
        const now = totals(o.daily, monthStart, o.dataThrough, p)
        const prev = totals(o.daily, prevStart, prevEnd, p)
        return [label, money(now.spend, cur), oneDp(now.results), money(now.costPerResult, cur), money(prev.costPerResult, cur)]
      }
      const blended = totals(o.daily, monthStart, o.dataThrough)
      return {
        ...base,
        note: `Month to date vs target ${money(ctx.target, cur)} per result. Previous month for trend.`,
        table: {
          columns: ["", "Spend MTD", "Results MTD", "Cost/result MTD", "Cost/result last month"],
          rows: [...platforms(o).map((p) => row(PLATFORM_LABEL[p], p)), row("Blended")],
        },
        facts: [{ label: "Blended vs target", value: money(blended.costPerResult, cur), status: status(blended.costPerResult) }],
      }
    }

    case "naming_full_review": {
      const monthStart = o.dataThrough.slice(0, 8) + "01"
      return {
        ...base,
        note: `Month to date from ${monthStart}. Review every active campaign and ad name in the platforms.`,
        facts: [
          { label: "Ads first seen this month", value: whole(o.newCreatives.length) },
          { label: "Live ads 45+ days old", value: whole(o.fatigued.length) },
        ],
      }
    }

    default:
      return null // landing_pages, utm_spot_check, utm_full_review: nothing from Windsor
  }
}
