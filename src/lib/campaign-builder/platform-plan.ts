import { z } from "zod"
import type { RedditSpec } from "@/lib/ads-api/spec"
import { MATCH_TYPES, META_CTAS, META_GOALS, META_OBJECTIVES, type GoogleSpec, type MetaSpec, type MicrosoftSpec } from "@/lib/ads-api/spec-platforms"
import { proposalSource } from "./plan-schema"

/**
 * Plans for Google Ads, Meta, Reddit and Microsoft Ads (Dean, 2026-10-21). LinkedIn keeps its own
 * plan (plan-schema.ts). Each plan is a draft of the platform's build spec plus the why: Claude
 * fills what it can, and anything only the team or the platform knows (a Meta page or instant form,
 * an uploaded image, a Reddit post, a location id Claude isn't sure of) stays empty until the team
 * fills it on the plan. A draft becomes a spec with `draftToSpec`, which lists what's still missing
 * and leaves out the ads the app can't build (they're briefed and built in the platform).
 * A plain module so the builder, the planner and the tests share it.
 */

export const BUILD_PLATFORMS = ["linkedin", "google_ads", "meta", "reddit", "microsoft_ads"] as const
export type BuildPlatform = (typeof BUILD_PLATFORMS)[number]
export type OtherPlatform = Exclude<BuildPlatform, "linkedin">
export const isBuildPlatform = (v: unknown): v is BuildPlatform => typeof v === "string" && (BUILD_PLATFORMS as readonly string[]).includes(v)

export const BUILD_PLATFORM_LABEL: Record<BuildPlatform, string> = { linkedin: "LinkedIn", google_ads: "Google Ads", meta: "Meta", reddit: "Reddit", microsoft_ads: "Microsoft Ads" }

/** Where each platform's builds are sent, and whether its create calls have been checked against a live account. */
export const ROUTE: Record<BuildPlatform, { via: string; verified: boolean }> = {
  linkedin: { via: "LinkedIn's API", verified: true },
  google_ads: { via: "Windsor", verified: false },
  meta: { via: "Windsor", verified: false },
  reddit: { via: "Reddit's API", verified: false },
  microsoft_ads: { via: "Microsoft's API", verified: false },
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const loc = z.object({ id: z.number().int().positive().nullable().default(null), name: z.string().min(1).max(200) })
const kw = z.object({ text: z.string().min(1).max(80), match: z.enum(MATCH_TYPES).default("PHRASE") })

/** Things the plan proposes that the app can't build on this platform: briefed, then built in the platform. */
const notBuilt = z.array(z.object({ name: z.string().max(255), format: z.string().max(60), brief: z.string().max(600).default("") })).max(10).default([])

const searchAd = z.object({
  headlines: z.array(z.string().max(60)).max(15).default([]),
  descriptions: z.array(z.string().max(120)).max(4).default([]),
  finalUrl: z.string().max(2000).default(""),
  path1: z.string().max(30).default(""),
  path2: z.string().max(30).default(""),
  fromProposal: z.boolean().default(false),
})
const adGroups = z
  .array(z.object({ name: z.string().min(1).max(255), cpcBid: z.number().positive().nullable().default(null), keywords: z.array(kw).max(200).default([]), ads: z.array(searchAd).max(3).default([]) }))
  .min(1)
  .max(10)

export const googleDraft = z.object({
  campaign: z.object({
    name: z.string().min(1).max(255),
    bidding: z.enum(["manual_cpc", "maximize_conversions", "target_spend"]).default("maximize_conversions"),
    dailyBudget: z.number().positive(),
    locations: z.array(loc).max(100).default([]),
    languages: z.array(z.string().max(10)).max(10).default(["en"]),
  }),
  adGroups,
  sitelinks: z.array(z.object({ text: z.string().max(40), finalUrl: z.string().max(2000).default(""), description1: z.string().max(60).default(""), description2: z.string().max(60).default("") })).max(8).default([]),
  callouts: z.array(z.string().max(40)).max(10).default([]),
  notBuilt,
})
export type GoogleDraft = z.infer<typeof googleDraft>

export const microsoftDraft = z.object({
  campaign: z.object({
    name: z.string().min(1).max(128),
    bidding: z.enum(["EnhancedCpc", "ManualCpc", "MaxClicks", "MaxConversions"]).default("MaxConversions"),
    dailyBudget: z.number().positive(),
    locations: z.array(loc).max(100).default([]),
    languages: z.array(z.string().max(40)).max(10).default(["English"]),
  }),
  adGroups,
  notBuilt,
})
export type MicrosoftDraft = z.infer<typeof microsoftDraft>

const metaAudience = z.object({ id: z.string().regex(/^\d+$/).nullable().default(null), name: z.string().min(1).max(200) })
export const metaDraft = z.object({
  pageId: z.string().regex(/^\d+$/).nullable().default(null),
  campaign: z.object({ name: z.string().min(1).max(255), objective: z.enum(META_OBJECTIVES), specialAdCategories: z.array(z.string()).default([]) }),
  adSet: z.object({
    name: z.string().min(1).max(255),
    dailyBudget: z.number().positive(),
    startDate: date,
    endDate: date.nullable().default(null),
    optimizationGoal: z.enum(META_GOALS),
    pixel: z.object({ pixelId: z.string().regex(/^\d+$/), event: z.string().min(1).max(100) }).nullable().default(null),
    targeting: z.object({
      baseAdSetId: z.string().regex(/^\d+$/).nullable().default(null),
      baseAdSetName: z.string().max(255).default(""),
      countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(25).default([]),
      ageMin: z.number().int().min(18).max(65).default(25),
      ageMax: z.number().int().min(18).max(65).default(65),
      customAudiences: z.array(metaAudience).max(50).default([]),
      excludedAudiences: z.array(metaAudience).max(50).default([]),
      advantageAudience: z.boolean().default(false),
      audienceNetwork: z.boolean().default(false),
    }),
  }),
  ads: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        format: z.enum(["single_image", "video", "carousel"]).default("single_image"),
        message: z.string().max(2000).default(""),
        headline: z.string().max(255).default(""),
        description: z.string().max(255).default(""),
        link: z.string().max(2000).default(""),
        callToAction: z.enum(META_CTAS).default("LEARN_MORE"),
        creativeBrief: z.string().max(1000).default(""),
        imagePath: z.string().max(300).nullable().default(null),
        leadFormId: z.string().regex(/^\d+$/).nullable().default(null),
        fromProposal: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(10),
  notBuilt,
})
export type MetaDraft = z.infer<typeof metaDraft>

export const redditDraft = z.object({
  campaign: z.object({ name: z.string().min(1).max(255), objective: z.enum(["CLICKS", "CONVERSIONS", "IMPRESSIONS", "LEAD_GENERATION", "BRAND_AWARENESS"]) }),
  adGroup: z.object({
    name: z.string().min(1).max(255),
    bidStrategy: z.enum(["MAXIMIZE_VOLUME", "MANUAL_BIDDING", "TARGET_CPX"]).default("MAXIMIZE_VOLUME"),
    bidType: z.enum(["CPC", "CPM"]).default("CPC"),
    bid: z.number().positive().nullable().default(null),
    dailyBudget: z.number().positive(),
    startDate: date,
    endDate: date.nullable().default(null),
    targeting: z.object({
      geolocations: z.array(z.string().min(2).max(20)).max(25).default([]),
      communities: z.array(z.string().max(100)).max(100).default([]),
      interests: z.array(z.string().max(100)).max(100).default([]),
      keywords: z.array(z.string().max(100)).max(200).default([]),
    }),
  }),
  ads: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        /** The post to promote (t3_…): Reddit ads run existing posts on the client's profile. */
        postId: z.string().regex(/^t3_\w+$/).nullable().default(null),
        clickUrl: z.string().max(2000).default(""),
        /** The post's copy, for the team to publish when there's no post yet. */
        headline: z.string().max(300).default(""),
        body: z.string().max(2000).default(""),
        creativeBrief: z.string().max(1000).default(""),
        fromProposal: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(10),
  notBuilt,
})
export type RedditDraft = z.infer<typeof redditDraft>

const DRAFTS = { google_ads: googleDraft, meta: metaDraft, reddit: redditDraft, microsoft_ads: microsoftDraft } as const
export type Draft<P extends OtherPlatform = OtherPlatform> = z.infer<(typeof DRAFTS)[P]>
export const draftSchema = <P extends OtherPlatform>(p: P) => DRAFTS[p]

const common = {
  summary: z.string().max(800),
  structure: z.array(z.object({ name: z.string().max(255), purpose: z.string().max(300) })).max(8).default([]),
  rationale: z.array(z.object({ point: z.string().max(400), source: z.string().max(120) })).max(10).default([]),
  practices: z.array(z.string().max(300)).max(12).default([]),
  risks: z.array(z.string().max(300)).max(6).default([]),
  success: z.string().max(400).default(""),
  proposal: proposalSource.nullable().default(null),
}

export const platformPlan = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("google_ads"), draft: googleDraft, ...common }),
  z.object({ platform: z.literal("meta"), draft: metaDraft, ...common }),
  z.object({ platform: z.literal("reddit"), draft: redditDraft, ...common }),
  z.object({ platform: z.literal("microsoft_ads"), draft: microsoftDraft, ...common }),
])
export type PlatformPlan = z.infer<typeof platformPlan>

/** Location ids Claude may fill without a lookup. Google's are documented; Microsoft's are unverified. */
export const KNOWN_LOCATIONS: Record<"google_ads" | "microsoft_ads", Record<string, number>> = {
  google_ads: { "united states": 2840, "united kingdom": 2826, canada: 2124, australia: 2036, ireland: 2372, germany: 2276, france: 2250, netherlands: 2528, "new zealand": 2554 },
  microsoft_ads: { "united states": 190, "united kingdom": 188, canada: 32, australia: 9 },
}
const ALIASES: Record<string, string> = { us: "united states", usa: "united states", "u.s.": "united states", uk: "united kingdom", gb: "united kingdom", "great britain": "united kingdom" }
export function knownLocation(platform: "google_ads" | "microsoft_ads", name: string): number | null {
  const n = name.trim().toLowerCase()
  return KNOWN_LOCATIONS[platform][ALIASES[n] ?? n] ?? null
}

/** Formats each platform's builder can create; the rest are briefed and built in the platform. */
export const BUILDABLE: Record<OtherPlatform, string> = {
  google_ads: "Search campaigns with responsive search ads, sitelinks and callouts",
  meta: "single image ads, to a landing page or an instant form",
  reddit: "ads from posts already on the client's Reddit profile",
  microsoft_ads: "Search campaigns with responsive search ads",
}

export type ToSpec<S> = { spec: S | null; missing: string[]; leftOut: string[] }

function searchSpec<B extends string>(d: { campaign: { name: string; bidding: B; dailyBudget: number; locations: { id: number | null; name: string }[]; languages: string[] }; adGroups: GoogleDraft["adGroups"] }, missing: string[], leftOut: string[]) {
  const locations = d.campaign.locations.filter((l) => {
    if (l.id) return true
    missing.push(`Location "${l.name}" needs its id.`)
    return false
  }) as { id: number; name: string }[]
  if (!d.campaign.locations.length) missing.push("Add at least one location.")
  const groups = d.adGroups.flatMap((g) => {
    const ads = g.ads.filter((a, i) => {
      const what = `${g.name}, ad ${i + 1}`
      if (a.headlines.filter(Boolean).length < 3 || a.descriptions.filter(Boolean).length < 2) {
        leftOut.push(`${what}: needs 3 headlines and 2 descriptions`)
        return false
      }
      if (!a.finalUrl) {
        missing.push(`${what} needs a landing page.`)
        return false
      }
      return true
    })
    if (!g.keywords.length) missing.push(`${g.name} needs keywords.`)
    if (!ads.length) {
      leftOut.push(`${g.name}: no complete ads, so the ad group is left out`)
      return []
    }
    return [
      {
        name: g.name,
        ...(g.cpcBid ? { cpcBid: g.cpcBid } : {}),
        keywords: g.keywords,
        ads: ads.map((a) => ({ headlines: a.headlines.filter(Boolean), descriptions: a.descriptions.filter(Boolean), finalUrl: a.finalUrl, ...(a.path1 ? { path1: a.path1 } : {}), ...(a.path2 ? { path2: a.path2 } : {}) })),
      },
    ]
  })
  return { campaign: { name: d.campaign.name, bidding: d.campaign.bidding, dailyBudget: d.campaign.dailyBudget, locations, languages: d.campaign.languages }, adGroups: groups }
}

export function googleToSpec(d: GoogleDraft): ToSpec<GoogleSpec> {
  const missing: string[] = []
  const leftOut = d.notBuilt.map((n) => `${n.name}: ${n.format} is built in Google Ads for now`)
  const s = searchSpec(d, missing, leftOut)
  if (!s.adGroups.length) missing.push("No ad group has a complete ad yet.")
  const spec: GoogleSpec = {
    ...s,
    sitelinks: d.sitelinks.filter((x) => x.text && x.finalUrl).map((x) => ({ text: x.text, finalUrl: x.finalUrl, ...(x.description1 ? { description1: x.description1 } : {}), ...(x.description2 ? { description2: x.description2 } : {}) })),
    callouts: d.callouts.filter(Boolean),
  }
  return { spec: missing.length ? null : spec, missing, leftOut }
}

export function microsoftToSpec(d: MicrosoftDraft): ToSpec<MicrosoftSpec> {
  const missing: string[] = []
  const leftOut = d.notBuilt.map((n) => `${n.name}: ${n.format} is built in Microsoft Advertising for now`)
  const s = searchSpec(d, missing, leftOut)
  if (!s.adGroups.length) missing.push("No ad group has a complete ad yet.")
  return { spec: missing.length ? null : s, missing, leftOut }
}

export function metaToSpec(d: MetaDraft): ToSpec<MetaSpec> {
  const missing: string[] = []
  const leftOut = d.notBuilt.map((n) => `${n.name}: ${n.format} is built in Ads Manager for now`)
  if (!d.pageId) missing.push("Pick the Facebook page the ads run as.")
  const s = d.adSet
  if (!s.targeting.countries.length) missing.push("Add at least one country.")
  if (s.optimizationGoal === "OFFSITE_CONVERSIONS" && !s.pixel) missing.push("Pick the pixel and event the ad set optimizes for.")
  const audiences = (list: MetaDraft["adSet"]["targeting"]["customAudiences"], what: string) =>
    list.filter((a) => {
      if (a.id) return true
      missing.push(`${what} "${a.name}" needs its id.`)
      return false
    }) as { id: string; name: string }[]
  const ads = d.ads.flatMap((a) => {
    if (a.format !== "single_image") {
      leftOut.push(`${a.name}: ${a.format.replace("_", " ")} ads are built in Ads Manager for now`)
      return []
    }
    if (!a.imagePath) {
      leftOut.push(`${a.name}: no image uploaded yet`)
      return []
    }
    if (!a.message || !a.headline || !a.link) {
      missing.push(`${a.name} needs primary text, a headline and a landing page.`)
      return []
    }
    if (s.optimizationGoal === "LEAD_GENERATION" && !a.leadFormId) {
      missing.push(`${a.name} needs an instant form.`)
      return []
    }
    return [{ name: a.name, message: a.message, headline: a.headline, ...(a.description ? { description: a.description } : {}), link: a.link, callToAction: a.callToAction, imagePath: a.imagePath, ...(a.leadFormId ? { leadFormId: a.leadFormId } : {}) }]
  })
  if (!ads.length) missing.push("No ad is ready to build yet (each needs an image).")
  const t = s.targeting
  const spec: MetaSpec = {
    pageId: d.pageId ?? "",
    campaign: d.campaign,
    adSet: {
      name: s.name,
      dailyBudget: s.dailyBudget,
      startDate: s.startDate,
      ...(s.endDate ? { endDate: s.endDate } : {}),
      optimizationGoal: s.optimizationGoal,
      ...(s.pixel ? { pixel: s.pixel } : {}),
      targeting: {
        ...(t.baseAdSetId ? { baseAdSetId: t.baseAdSetId } : {}),
        countries: t.countries,
        ageMin: t.ageMin,
        ageMax: t.ageMax,
        customAudiences: audiences(t.customAudiences, "Audience"),
        excludedAudiences: audiences(t.excludedAudiences, "Excluded audience"),
        advantageAudience: t.advantageAudience,
        audienceNetwork: t.audienceNetwork,
      },
    },
    ads,
  }
  return { spec: missing.length ? null : spec, missing, leftOut }
}

export function redditToSpec(d: RedditDraft): ToSpec<RedditSpec> {
  const missing: string[] = []
  const leftOut = d.notBuilt.map((n) => `${n.name}: ${n.format} is built in Reddit Ads for now`)
  const g = d.adGroup
  if (!g.targeting.geolocations.length) missing.push("Add at least one location.")
  if (g.bidStrategy !== "MAXIMIZE_VOLUME" && !g.bid) missing.push("Manual and target bidding need a bid.")
  const ads = d.ads.flatMap((a) => {
    if (!a.postId) {
      leftOut.push(`${a.name}: publish the post on the client's Reddit profile, then add its id (t3_…)`)
      return []
    }
    if (!a.clickUrl) {
      missing.push(`${a.name} needs a landing page.`)
      return []
    }
    return [{ name: a.name, postId: a.postId, clickUrl: a.clickUrl }]
  })
  if (!ads.length) missing.push("No ad has a Reddit post yet.")
  const targeting = Object.fromEntries(Object.entries(g.targeting).filter(([, v]) => v.length)) as RedditSpec["adGroup"]["targeting"]
  const spec: RedditSpec = {
    campaign: d.campaign,
    adGroup: { name: g.name, bidStrategy: g.bidStrategy, bidType: g.bidType, ...(g.bid ? { bid: g.bid } : {}), dailyBudget: g.dailyBudget, startDate: g.startDate, ...(g.endDate ? { endDate: g.endDate } : {}), targeting },
    ads,
  }
  return { spec: missing.length ? null : spec, missing, leftOut }
}

/** A reviewed plan → the build spec for its platform. */
export function draftToSpec(p: PlatformPlan): ToSpec<GoogleSpec | MetaSpec | RedditSpec | MicrosoftSpec> {
  switch (p.platform) {
    case "google_ads":
      return googleToSpec(p.draft)
    case "meta":
      return metaToSpec(p.draft)
    case "reddit":
      return redditToSpec(p.draft)
    case "microsoft_ads":
      return microsoftToSpec(p.draft)
  }
}

/** The campaign's name, for the build row. */
export const draftName = (p: PlatformPlan) => p.draft.campaign.name
