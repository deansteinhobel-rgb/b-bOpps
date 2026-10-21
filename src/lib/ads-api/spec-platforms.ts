import { z } from "zod"
import type { GuardFacts } from "@/lib/campaign-builder/guardrails"
import { checkBudget, onClientSite, type BuildContext, type Check } from "./spec"

/**
 * What a campaign build holds for Google Ads, Meta and Microsoft Ads (Dean, 2026-10-21), and the
 * checks each passes on the server before it is sent (dry runs included). LinkedIn and Reddit are
 * in spec.ts. A plain module so the tests can use it.
 *
 * - Google Ads: a Search campaign with its budget, locations and languages, ad groups with keywords
 *   and responsive search ads, and optional sitelinks and callouts. Through Windsor's write actions,
 *   which can't create Display, Performance Max, Demand Gen or video ads: those are planned and
 *   briefed, then built in Google Ads.
 * - Meta: a campaign, one ad set (its targeting starts from one of the account's own ad sets, read
 *   whole from Windsor, so custom audiences and exclusions carry over), and single image ads, to a
 *   landing page or an instant form. Through Windsor.
 * - Microsoft Ads: like Google Search, through Microsoft's own API. UNVERIFIED until the first live
 *   build, and no client has a Microsoft account mapped yet (reporting comes first).
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
const money = z.number().positive()
const https = z.url({ protocol: /^https$/ })

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`)

// ---------------------------------------------------------------- search (Google and Microsoft)

export const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const
const keyword = z.object({ text: z.string().trim().min(1).max(80), match: z.enum(MATCH_TYPES) })
const searchAd = z.object({
  headlines: z.array(z.string().trim().min(1).max(30, "Headlines are 30 characters at most")).min(3).max(15),
  descriptions: z.array(z.string().trim().min(1).max(90, "Descriptions are 90 characters at most")).min(2).max(4),
  finalUrl: https,
  path1: z.string().max(15).optional(),
  path2: z.string().max(15).optional(),
})
const location = z.object({ id: z.number().int().positive(), name: z.string().min(1).max(200) })

export const googleSpec = z.object({
  campaign: z.object({
    name: z.string().min(1).max(255),
    bidding: z.enum(["manual_cpc", "maximize_conversions", "target_spend"]),
    dailyBudget: money,
    /** Google's geo target constants (2840 United States, 2826 United Kingdom). */
    locations: z.array(location).min(1).max(100),
    /** Google Ads language codes (en, de, es…). */
    languages: z.array(z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/)).min(1).max(10),
  }),
  adGroups: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        /** Max CPC for manual CPC campaigns. */
        cpcBid: money.optional(),
        keywords: z.array(keyword).min(1).max(200),
        ads: z.array(searchAd).min(1).max(3),
      }),
    )
    .min(1)
    .max(10),
  sitelinks: z.array(z.object({ text: z.string().trim().min(1).max(25), finalUrl: https, description1: z.string().max(35).optional(), description2: z.string().max(35).optional() })).max(8).default([]),
  callouts: z.array(z.string().trim().min(1).max(25)).max(10).default([]),
})
export type GoogleSpec = z.infer<typeof googleSpec>

export const microsoftSpec = z.object({
  campaign: z.object({
    name: z.string().min(1).max(128),
    bidding: z.enum(["EnhancedCpc", "ManualCpc", "MaxClicks", "MaxConversions"]),
    dailyBudget: money,
    /** Microsoft's location ids (190 United States, 188 United Kingdom; unverified). */
    locations: z.array(location).min(1).max(100),
    /** Microsoft's language names: English, German, French… */
    languages: z.array(z.string().min(2).max(40)).min(1).max(10),
  }),
  adGroups: googleSpec.shape.adGroups,
})
export type MicrosoftSpec = z.infer<typeof microsoftSpec>

type SearchSpec = { campaign: { bidding: string; dailyBudget: number }; adGroups: { name: string; cpcBid?: number; keywords: { text: string }[]; ads: z.infer<typeof searchAd>[] }[] }

function checkSearch(spec: SearchSpec, ctx: BuildContext, errors: string[], warnings: string[], manual: boolean) {
  const seen = new Set<string>()
  for (const [g, group] of spec.adGroups.entries()) {
    const label = `Ad group ${g + 1} (${group.name})`
    if (manual && !group.cpcBid) errors.push(`${label}: manual CPC needs a max CPC bid.`)
    if (group.cpcBid && group.cpcBid > spec.campaign.dailyBudget) errors.push(`${label}: the max CPC is higher than the daily budget.`)
    const kw = new Set<string>()
    for (const k of group.keywords) {
      const key = k.text.toLowerCase()
      if (kw.has(key)) warnings.push(`${label}: "${k.text}" is in twice.`)
      kw.add(key)
    }
    for (const [a, ad] of group.ads.entries()) {
      if (!onClientSite(ad.finalUrl, ctx.website)) errors.push(`${label}, ad ${a + 1}: the landing page isn't on ${ctx.website ?? "the client's website (none is set)"}.`)
      if (ad.path2 && !ad.path1) errors.push(`${label}, ad ${a + 1}: path 2 needs path 1.`)
      const lower = ad.headlines.map((h) => h.toLowerCase())
      if (new Set(lower).size < lower.length) errors.push(`${label}, ad ${a + 1}: two headlines are the same.`)
      if (ad.headlines.some((h) => h.includes("!"))) errors.push(`${label}, ad ${a + 1}: Google doesn't allow "!" in headlines.`)
      if (ad.headlines.length < 8) warnings.push(`${label}, ad ${a + 1}: ${ad.headlines.length} headlines; Google rates ads with 8 or more higher.`)
    }
    const name = group.name.toLowerCase()
    if (seen.has(name)) errors.push(`Two ad groups are called "${group.name}".`)
    seen.add(name)
  }
  checkBudget(spec.campaign.dailyBudget, ctx, errors, warnings)
}

export function checkGoogle(raw: unknown, ctx: BuildContext): Check & { spec?: GoogleSpec } {
  const parsed = googleSpec.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: issues(parsed.error), warnings: [] }
  const spec = parsed.data
  const errors: string[] = []
  const warnings: string[] = ["Windsor creates Search campaigns with Google's default networks: switch Search Partners and the Display Network off in Google Ads before turning it on, unless the test wants them."]
  checkSearch(spec, ctx, errors, warnings, spec.campaign.bidding === "manual_cpc")
  for (const [i, s] of spec.sitelinks.entries()) if (!onClientSite(s.finalUrl, ctx.website)) errors.push(`Sitelink ${i + 1}: the link isn't on the client's website.`)
  return { ok: errors.length === 0, errors, warnings, spec }
}

export function checkMicrosoft(raw: unknown, ctx: BuildContext): Check & { spec?: MicrosoftSpec } {
  const parsed = microsoftSpec.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: issues(parsed.error), warnings: [] }
  const spec = parsed.data
  const errors: string[] = []
  const warnings: string[] = ["Microsoft Ads' create calls are unverified: check the dry run's payloads against Microsoft's docs before going live."]
  checkSearch(spec, ctx, errors, warnings, spec.campaign.bidding === "ManualCpc")
  return { ok: errors.length === 0, errors, warnings, spec }
}

// ---------------------------------------------------------------- Meta

export const META_OBJECTIVES = ["OUTCOME_LEADS", "OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"] as const
export const META_GOALS = ["LEAD_GENERATION", "OFFSITE_CONVERSIONS", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "REACH", "IMPRESSIONS"] as const
export const META_CTAS = ["LEARN_MORE", "DOWNLOAD", "SIGN_UP", "GET_QUOTE", "CONTACT_US", "APPLY_NOW", "BOOK_NOW", "SUBSCRIBE"] as const
const metaCta = z.enum(META_CTAS)
const audience = z.object({ id: z.string().regex(/^\d+$/, "A Meta audience id"), name: z.string().max(200).default("") })

export const metaSpec = z.object({
  /** The Facebook page the ads run as (from the account's own ad sets). */
  pageId: z.string().regex(/^\d+$/, "A Facebook page id"),
  campaign: z.object({
    name: z.string().min(1).max(255),
    objective: z.enum(META_OBJECTIVES),
    /** HOUSING, EMPLOYMENT, CREDIT… or empty. */
    specialAdCategories: z.array(z.string()).default([]),
  }),
  adSet: z.object({
    name: z.string().min(1).max(255),
    dailyBudget: money,
    startDate: date,
    endDate: date.optional(),
    optimizationGoal: z.enum(META_GOALS),
    /** Website conversions: the pixel and event the ad set optimizes for. */
    pixel: z.object({ pixelId: z.string().regex(/^\d+$/), event: z.string().min(1).max(100) }).optional(),
    targeting: z.object({
      /** The account's ad set this one's targeting starts from (custom audiences, exclusions, interests). */
      baseAdSetId: z.string().regex(/^\d+$/).optional(),
      /** That ad set's full targeting as Windsor returned it when the build was saved. */
      base: z.record(z.string(), z.unknown()).optional(),
      countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(25),
      ageMin: z.number().int().min(18).max(65).default(25),
      ageMax: z.number().int().min(18).max(65).default(65),
      customAudiences: z.array(audience).max(50).default([]),
      excludedAudiences: z.array(audience).max(50).default([]),
      /** Advantage+ audience (Meta may go past the audience). Off by default. */
      advantageAudience: z.boolean().default(false),
      /** Audience Network placements. Off by default (an urgent settings check). */
      audienceNetwork: z.boolean().default(false),
    }),
  }),
  ads: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        /** Primary text. */
        message: z.string().min(1).max(2000),
        headline: z.string().min(1).max(255),
        description: z.string().max(255).optional(),
        link: https,
        callToAction: metaCta.default("LEARN_MORE"),
        /** Our copy of the image in campaign-assets; the sender hands Meta a short-lived link to it. */
        imagePath: z.string().min(1),
        /** Lead ads: the instant form (picked by the team, never Claude). */
        leadFormId: z.string().regex(/^\d+$/).optional(),
      }),
    )
    .min(1)
    .max(10),
})
export type MetaSpec = z.infer<typeof metaSpec>

export function checkMeta(raw: unknown, ctx: BuildContext): Check & { spec?: MetaSpec } {
  const parsed = metaSpec.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: issues(parsed.error), warnings: [] }
  const spec = parsed.data
  const errors: string[] = []
  const warnings: string[] = []
  const s = spec.adSet
  const t = s.targeting
  if (s.startDate < ctx.today) errors.push("The start date is in the past.")
  if (s.endDate && s.endDate <= s.startDate) errors.push("The end date must be after the start date.")
  if (t.ageMin > t.ageMax) errors.push("The youngest age is above the oldest.")
  if (s.dailyBudget < 1) errors.push("Meta's minimum daily budget is 1.")
  if (s.optimizationGoal === "OFFSITE_CONVERSIONS" && !s.pixel) errors.push("Website conversions need the pixel and event to optimize for.")
  if (s.optimizationGoal === "LEAD_GENERATION" && spec.ads.some((a) => !a.leadFormId)) errors.push("Lead ads need an instant form on every ad: pick one of the page's forms.")
  if (s.optimizationGoal !== "LEAD_GENERATION" && spec.ads.some((a) => a.leadFormId)) errors.push("Only lead ad sets (goal LEAD_GENERATION) use an instant form.")
  if (spec.campaign.objective === "OUTCOME_LEADS" && !["LEAD_GENERATION", "OFFSITE_CONVERSIONS"].includes(s.optimizationGoal)) errors.push("A leads campaign optimizes for leads or website conversions.")
  if (t.baseAdSetId && !t.base) errors.push("The ad set to copy the audience from couldn't be read from Windsor.")
  if (t.advantageAudience && t.customAudiences.length) warnings.push("Advantage+ audience is on with a custom audience: Meta may show the ads well beyond the list.")
  const included = new Set(t.customAudiences.map((a) => a.id))
  if (t.excludedAudiences.some((a) => included.has(a.id))) errors.push("An audience is both included and excluded.")
  for (const [i, ad] of spec.ads.entries()) {
    if (ctx.clientId && !ad.imagePath.startsWith(`${ctx.clientId}/`)) errors.push(`Ad ${i + 1}: that image belongs to another client.`)
    if (!onClientSite(ad.link, ctx.website)) errors.push(`Ad ${i + 1}: the landing page isn't on ${ctx.website ?? "the client's website (none is set)"}.`)
    if (ad.message.length > 125) warnings.push(`Ad ${i + 1}: primary text over 125 characters is cut off behind "See more".`)
    if (ad.headline.length > 40) warnings.push(`Ad ${i + 1}: headlines over 40 characters are cut off on mobile.`)
  }
  checkBudget(s.dailyBudget, ctx, errors, warnings)
  return { ok: errors.length === 0, errors, warnings, spec }
}

/**
 * The ad set's targeting: the base ad set's (read whole), with this build's countries, ages and
 * audiences on top. Placements are always set: Facebook and Instagram, plus the Audience Network
 * only when asked. Advantage+ audience is set explicitly either way.
 */
export function metaTargeting(t: MetaSpec["adSet"]["targeting"]): Record<string, unknown> {
  const base = { ...(t.base ?? {}) }
  // Meta refuses a targeting that mixes the base's own placement or location shape with ours.
  delete base.publisher_platforms
  delete base.audience_network_positions
  const geo = (base.geo_locations as Record<string, unknown> | undefined) ?? {}
  const ids = (list: { id: string }[]) => list.map((a) => ({ id: a.id }))
  const merged = (key: "custom_audiences" | "excluded_custom_audiences", extra: { id: string }[]) => {
    const have = Array.isArray(base[key]) ? (base[key] as { id?: string }[]).filter((a) => a?.id) : []
    const all = [...have.map((a) => ({ id: String(a.id) })), ...ids(extra)]
    return all.filter((a, i) => all.findIndex((b) => b.id === a.id) === i)
  }
  const custom = merged("custom_audiences", t.customAudiences)
  const excluded = merged("excluded_custom_audiences", t.excludedAudiences)
  return {
    ...base,
    // Countries replace the base's whole location (regions, cities and location types included).
    geo_locations: { countries: t.countries, location_types: (geo.location_types as string[] | undefined)?.filter((x) => x === "home") ?? ["home"] },
    age_min: t.ageMin,
    age_max: t.ageMax,
    ...(custom.length ? { custom_audiences: custom } : {}),
    ...(excluded.length ? { excluded_custom_audiences: excluded } : {}),
    publisher_platforms: t.audienceNetwork ? ["facebook", "instagram", "audience_network"] : ["facebook", "instagram"],
    targeting_automation: { advantage_audience: t.advantageAudience ? 1 : 0 },
  }
}

// ---------------------------------------------------------------- guardrail facts

/** Google and Microsoft: every RSA headline and description counts; keywords are the "facet". */
export function searchFacts(spec: GoogleSpec | MicrosoftSpec): GuardFacts {
  const ads = spec.adGroups.flatMap((g) => g.ads.map((a, i) => ({ ad: `${g.name} ad ${i + 1}`, a })))
  const bids = spec.adGroups.map((g) => g.cpcBid).filter((b): b is number => typeof b === "number")
  return {
    dailyBudget: spec.campaign.dailyBudget,
    bid: bids.length ? Math.max(...bids) : null,
    ads: ads.length,
    audienceNetwork: null,
    objective: spec.campaign.bidding,
    headlines: ads.flatMap(({ ad, a }) => a.headlines.map((text) => ({ ad, text }))),
    intros: ads.flatMap(({ ad, a }) => a.descriptions.map((text) => ({ ad, text }))),
    facets: ["keywords", "locations", ...(spec.campaign.languages.length ? ["languages"] : [])],
  }
}

export function metaFacts(spec: MetaSpec): GuardFacts {
  const t = spec.adSet.targeting
  return {
    dailyBudget: spec.adSet.dailyBudget,
    bid: null,
    ads: spec.ads.length,
    audienceNetwork: t.audienceNetwork,
    objective: spec.campaign.objective,
    headlines: spec.ads.map((a) => ({ ad: a.name, text: a.headline })),
    intros: spec.ads.map((a) => ({ ad: a.name, text: a.message })),
    facets: ["countries", ...(t.customAudiences.length ? ["custom_audiences"] : []), ...(t.excludedAudiences.length ? ["excluded_custom_audiences"] : []), ...(t.advantageAudience ? ["advantage_audience"] : [])],
  }
}
