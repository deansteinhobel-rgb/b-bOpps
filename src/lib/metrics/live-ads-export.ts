import type { AdStat, FatiguedAd } from "./ads"
import { PLATFORM_LABEL } from "./types"

/**
 * Live ads as a CSV (Dean, 2026-09-30: "all current live ABX ads" for Camber, one row per ad). Live =
 * the ad-fatigue rule (impressions in the last 2 available days); numbers are the last 30 days to
 * the latest synced day. Audience, content piece, format and objective are read from the naming
 * conventions: LinkedIn "ABM | Enterprise Contact Target List | {content} | {format} | {objective} | …",
 * Meta campaign "ABX - Lead Gen" with ads "Single Image #1 - {content}". Anything that doesn't
 * follow them is left blank rather than guessed.
 */

/** ABX / ABM campaigns (account-based: named "ABM | …" on LinkedIn, "ABX - …" on Meta). */
export const isAbx = (campaign: string | null) => /\bAB[MX]\b/i.test(campaign ?? "")

export type Creative = { ad_type: string | null; preview_link: string | null; final_url: string | null }

export type LiveAdRow = {
  platform: string
  audience: string
  content: string
  format: string
  objective: string
  adName: string
  clickThrough: string
  link: string
  firstSeen: string
  spend: number
  impressions: number
  clicks: number
  results: number
  campaign: string
  adId: string
}

const parts = (s: string, sep: RegExp) => s.split(sep).map((p) => p.trim()).filter(Boolean)

/** What the campaign and ad names say about the ad. */
export function readNames(platform: string, campaign: string, adName: string) {
  const out = { audience: "", content: "", format: "", objective: "" }
  const pipes = parts(campaign, /\|/)
  if (pipes.length >= 3) {
    out.audience = pipes[1].replace(/\s*contact target list\s*$/i, "")
    out.content = pipes[2]
    out.format = pipes[3] ?? ""
    out.objective = pipes[4] ?? ""
    return out
  }
  // Meta style: campaign "ABX - Lead Gen", ad "Single Image #1 - The AI Arms Race".
  const [camp, ...goal] = parts(campaign, /\s+-\s+/)
  if (goal.length) {
    out.audience = platform === "meta" ? `${camp} (Meta)` : camp
    out.objective = goal.join(" - ")
  }
  const [fmt, ...content] = parts(adName, /\s+-\s+/)
  if (content.length) {
    out.format = fmt.replace(/\s*#\d+\s*$/, "")
    out.content = content.join(" - ")
  }
  return out
}

function clickThrough(platform: string, objective: string, c: Creative | undefined) {
  if (c?.final_url) return c.final_url
  if (platform === "linkedin" && c?.ad_type === "NATIVE_DOCUMENT") return "(document in LinkedIn: no click-through URL)"
  if (platform === "meta" && /lead/i.test(objective)) return "(Meta instant form: no website destination)"
  return ""
}

export function liveAdRows(live: FatiguedAd[], last30: AdStat[], creatives: Map<string, Creative>, keyOf: (a: { platform: string; external_account_id: string; ad_id: string }) => string): LiveAdRow[] {
  const stats = new Map(last30.map((a) => [keyOf(a), a]))
  return live
    .map((a) => {
      const k = keyOf(a)
      const s = stats.get(k)
      const campaign = a.campaign_name ?? s?.campaign_name ?? ""
      const adName = a.ad_name ?? s?.ad_name ?? ""
      const names = readNames(a.platform, campaign, adName)
      return {
        platform: PLATFORM_LABEL[a.platform],
        ...names,
        adName,
        clickThrough: clickThrough(a.platform, names.objective, creatives.get(k)),
        link: creatives.get(k)?.preview_link ?? "",
        firstSeen: a.first_seen,
        spend: s?.spend ?? 0,
        impressions: s?.impressions ?? 0,
        clicks: s?.clicks ?? 0,
        results: (s?.conversions ?? 0) + (s?.leads ?? 0),
        campaign,
        adId: a.ad_id,
      }
    })
    .sort((x, y) => x.content.localeCompare(y.content) || x.audience.localeCompare(y.audience) || x.adName.localeCompare(y.adName))
}

const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`

export function liveAdsCsv(rows: LiveAdRow[], symbol: string): string {
  const head = ["Platform", "Audience", "Content piece", "Format", "Objective", "Ad name", "Ad click-through", "Ad / post link", "First seen", `Spend 30d (${symbol})`, "Impressions 30d", "Clicks 30d", "CTR", "Results 30d", "Campaign", "Ad ID"]
  const lines = rows.map((r) =>
    [
      r.platform,
      r.audience,
      r.content,
      r.format,
      r.objective,
      r.adName,
      r.clickThrough,
      r.link,
      r.firstSeen,
      Math.round(r.spend),
      Math.round(r.impressions),
      Math.round(r.clicks),
      r.impressions ? `${((r.clicks / r.impressions) * 100).toFixed(2)}%` : "0.00%",
      Math.round(r.results * 100) / 100,
      r.campaign,
      r.adId,
    ]
      .map(cell)
      .join(","),
  )
  // BOM so Excel reads the file as UTF-8 (em dashes, £).
  return "﻿" + [head.map(cell).join(","), ...lines].join("\r\n") + "\r\n"
}
