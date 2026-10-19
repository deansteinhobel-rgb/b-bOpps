/**
 * Google Ads assets (Dean, 2026-10-19): Performance Max and Demand Gen campaigns have no ad rows
 * (PMax) or no image (Demand Gen multi-asset ads), so their numbers come per asset instead
 * (`pmax_asset` / `ad_asset` breakdowns). Assets serve together in one ad, so their numbers overlap
 * and never add up to the campaign: compare assets of the same type only.
 * Pure functions (plain module: the campaign page, the client report and the shared link use it).
 */
import { money, percent, whole } from "@/lib/format"
import { pickAds, type AdPicks, type ReportAd } from "./client-report"
import { derive, type Derived } from "./performance"

export type AssetKind = "text" | "image" | "video" | "other"
export type Asset = {
  /** Google's asset id plus its field type: one asset can be a square image and a logo. */
  key: string
  id: string
  field: string
  kind: AssetKind
  text: string | null
  /** A Google-hosted image (tpc.googlesyndication.com) or a YouTube thumbnail. */
  imageUrl: string | null
  videoTitle: string | null
  videoUrl: string | null
  /** Asset groups (PMax) or ad groups (Demand Gen) it served in. */
  groups: string[]
  /** PMax: the asset group's ad strength (the strongest wording when it sits in several). */
  adStrength: string | null
  m: Derived
}
export type AssetSource = "pmax" | "ad"

/** One row from breakdown_totals for an asset kind (dim1 = asset id, dim2 = field type). */
export type AssetTotalsRow = { groupId: string; groupName: string | null; dim1: string; dim2: string; extra: Record<string, unknown> | null; m: Derived }

// Field types in reading order: images first, then video, then the words, then the rest.
const FIELDS: { field: string; label: string; one: string }[] = [
  { field: "MARKETING_IMAGE", label: "Landscape images", one: "landscape image" },
  { field: "SQUARE_MARKETING_IMAGE", label: "Square images", one: "square image" },
  { field: "PORTRAIT_MARKETING_IMAGE", label: "Portrait images", one: "portrait image" },
  { field: "TALL_PORTRAIT_MARKETING_IMAGE", label: "Tall portrait images", one: "tall portrait image" },
  { field: "YOUTUBE_VIDEO", label: "Videos", one: "video" },
  { field: "HEADLINE", label: "Headlines", one: "headline" },
  { field: "LONG_HEADLINE", label: "Long headlines", one: "long headline" },
  { field: "DESCRIPTION", label: "Descriptions", one: "description" },
  { field: "LOGO", label: "Logos", one: "logo" },
  { field: "LANDSCAPE_LOGO", label: "Landscape logos", one: "landscape logo" },
  { field: "BUSINESS_NAME", label: "Business name", one: "business name" },
  { field: "CALL_TO_ACTION_SELECTION", label: "Call to action", one: "call to action" },
]
const ORDER = new Map(FIELDS.map((f, i) => [f.field, i]))
const words = (field: string) => field.toLowerCase().replace(/_/g, " ")
export const fieldLabel = (field: string) => FIELDS.find((f) => f.field === field)?.label ?? words(field).replace(/^\w/, (c) => c.toUpperCase())
export const fieldOrder = (field: string) => ORDER.get(field) ?? FIELDS.length
/** Images people see in the ad (logos sit beside every ad, so they're never compared with them). */
export const isAdImage = (a: Pick<Asset, "kind" | "field">) => a.kind === "image" && !/LOGO/.test(a.field)

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const GOOGLE_IMAGE = /^https:\/\/tpc\.googlesyndication\.com\/[\w/.-]+$/
const YOUTUBE_ID = /^[\w-]{11}$/
const STRENGTH = ["EXCELLENT", "GOOD", "AVERAGE", "POOR", "PENDING"]

function kindOf(type: string | null, field: string): AssetKind {
  if (type === "TEXT") return "text"
  if (type === "IMAGE") return "image"
  if (type === "YOUTUBE_VIDEO") return "video"
  if (/IMAGE|LOGO/.test(field)) return "image"
  if (field === "YOUTUBE_VIDEO") return "video"
  if (/HEADLINE|DESCRIPTION|BUSINESS_NAME/.test(field)) return "text"
  return "other"
}

/**
 * Per-group totals into one row per asset (an asset in several asset groups is added up), with
 * what it is. Only https image URLs on Google's ad image host and real YouTube ids are kept.
 */
export function mergeAssets(rows: AssetTotalsRow[]): Asset[] {
  const by = new Map<string, Asset & { sums: { spend: number; impressions: number; clicks: number; conversions: number; leads: number } }>()
  for (const r of rows) {
    if (!r.dim1) continue
    const key = `${r.dim1}|${r.dim2}`
    const e = r.extra ?? {}
    const image = str(e.asset_image_asset_full_size_url)
    const video = str(e.asset_youtube_video_asset_youtube_video_id)
    const group = r.groupName ?? r.groupId
    const prev = by.get(key)
    if (prev) {
      for (const k of ["spend", "impressions", "clicks", "conversions", "leads"] as const) prev.sums[k] += r.m[k]
      if (group && !prev.groups.includes(group)) prev.groups.push(group)
      const s = str(e.asset_group_ad_strength)
      if (s && (!prev.adStrength || STRENGTH.indexOf(s) < STRENGTH.indexOf(prev.adStrength))) prev.adStrength = s
      continue
    }
    const videoId = video && YOUTUBE_ID.test(video) ? video : null
    by.set(key, {
      key,
      id: r.dim1,
      field: r.dim2,
      kind: kindOf(str(e.asset_type), r.dim2),
      text: str(e.asset_text_asset_text),
      imageUrl: image && GOOGLE_IMAGE.test(image) ? image : videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null,
      videoTitle: str(e.asset_youtube_video_asset_youtube_video_title),
      videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
      groups: group ? [group] : [],
      adStrength: str(e.asset_group_ad_strength),
      m: r.m,
      sums: { spend: r.m.spend, impressions: r.m.impressions, clicks: r.m.clicks, conversions: r.m.conversions, leads: r.m.leads },
    })
  }
  return [...by.values()]
    .map(({ sums, ...a }) => ({ ...a, m: derive(sums) }))
    .sort((a, b) => fieldOrder(a.field) - fieldOrder(b.field) || b.m.spend - a.m.spend || b.m.impressions - a.m.impressions)
}

/** What to call an asset in a list: its words, the video's title, or what kind of image it is. */
export const assetName = (a: Asset) => a.text ?? a.videoTitle ?? (a.kind === "image" ? `${FIELDS.find((f) => f.field === a.field)?.one ?? "image"} ${a.id}` : a.id)

/** The asset types on a campaign, in reading order, with their assets. */
export function assetGroups(assets: Asset[]) {
  const by = new Map<string, Asset[]>()
  for (const a of assets) by.set(a.field, [...(by.get(a.field) ?? []), a])
  return [...by.entries()].sort(([a], [b]) => fieldOrder(a) - fieldOrder(b)).map(([field, list]) => ({ field, label: fieldLabel(field), assets: list }))
}

export type AssetPick = ReportAd & { asset: Asset }
export type AssetSection = { key: "images" | "headlines"; label: string; one: string; basis: AdPicks["basis"]; best: AssetPick[]; worst: AssetPick[] }

/**
 * The client report's top and weakest assets for one PMax or Demand Gen campaign: images (in the ad,
 * not logos) first, then headlines, each against its own type only. Same rule as ads (pickAds):
 * assets that spent more than the median asset, by cost per result when 2+ have 3+ results,
 * otherwise by click-through rate. A type needs 2+ assets with spend to compare.
 */
export function pickAssets(assets: Asset[], n = 3): AssetSection[] {
  const sections: { key: AssetSection["key"]; label: string; one: string; list: Asset[] }[] = [
    { key: "images", label: "Images", one: "image", list: assets.filter(isAdImage) },
    { key: "headlines", label: "Headlines", one: "headline", list: assets.filter((a) => a.field === "HEADLINE") },
  ]
  const out: AssetSection[] = []
  for (const s of sections) {
    const spent = s.list.filter((a) => a.m.spend > 0)
    if (spent.length < 2) continue
    const byId = new Map(spent.map((a) => [a.key, a]))
    const picks = pickAds(
      spent.map((a) => ({ platform: "google_ads", external_account_id: "", ad_id: a.key, ad_name: assetName(a), campaign_name: null, spend: a.m.spend, impressions: a.m.impressions, clicks: a.m.clicks, conversions: a.m.conversions, leads: a.m.leads })),
      n,
    )
    const withAsset = (list: ReportAd[]) => list.map((p) => ({ ...p, asset: byId.get(p.ad_id)! }))
    out.push({ key: s.key, label: s.label, one: s.one, basis: picks.basis, best: withAsset(picks.best), worst: withAsset(picks.worst) })
  }
  return out
}

/** "What happened" for the client: the strongest headline in words (images are shown, not named). */
export function assetSentence(s: AssetSection, currency: string): string | null {
  const b = s.best[0]
  if (!b || s.key !== "headlines") return null
  return s.basis === "cost_per_result"
    ? `The strongest headline was “${assetName(b.asset)}”, in ads that brought ${whole(b.results)} results at ${money(b.costPerResult, currency)} each.`
    : `The headline that drew the most clicks was “${assetName(b.asset)}”: ${percent(b.ctr, 2)} of the people who saw it clicked.`
}
