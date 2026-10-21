import { z } from "zod"

/**
 * What a campaign build holds (`campaign_builds.spec`), per platform, and the checks every build
 * passes on the server before it is sent (dry runs included). A plain module so the tests can use it.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
const money = z.number().positive()
const urns = z.array(z.string().regex(/^urn:li:[A-Za-z]+:.+$/, "Use full LinkedIn URNs")).min(1)

/** LinkedIn: a campaign group (new, or one that exists), one campaign, single image ads. */
export const linkedInSpec = z.object({
  /** The company page the ads run as (the post author), numeric id. */
  organizationId: z.string().regex(/^\d+$/),
  group: z.union([z.object({ existingId: z.string().regex(/^\d+$/) }), z.object({ name: z.string().min(1).max(255), startDate: date })]),
  campaign: z.object({
    name: z.string().min(1).max(255),
    objective: z.enum(["BRAND_AWARENESS", "WEBSITE_VISIT", "ENGAGEMENT", "VIDEO_VIEW", "LEAD_GENERATION", "WEBSITE_CONVERSION"]),
    costType: z.enum(["CPC", "CPM"]),
    bid: money,
    dailyBudget: money,
    startDate: date,
    endDate: date.optional(),
    locale: z.object({ country: z.string().length(2), language: z.string().length(2) }),
    /** Facet name → URNs, e.g. { locations: ["urn:li:geo:103644278"], interfaceLocales: ["urn:li:locale:en_US"] }. */
    targeting: z.object({ include: z.record(z.string(), urns), exclude: z.record(z.string(), urns).optional() }),
    /** LinkedIn Audience Network. Off by default; LinkedIn refuses it on lead gen campaigns. */
    offsiteDelivery: z.boolean().default(false),
  }),
  ads: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        /** Intro text above the image. */
        commentary: z.string().min(1).max(600),
        headline: z.string().min(1).max(200),
        /** Needed for image ads; a sponsored post keeps its own link. */
        landingUrl: z.union([z.url({ protocol: /^https$/ }), z.literal("")]).default(""),
        callToAction: z.enum(["LEARN_MORE", "DOWNLOAD", "REGISTER", "SIGN_UP", "SUBSCRIBE", "REQUEST_DEMO", "APPLY", "VIEW_QUOTE", "ATTEND", "JOIN"]).default("LEARN_MORE"),
        /** Our copy of the image in storage (campaign-assets, `<client_id>/…`), read on the server when the image is uploaded. */
        imagePath: z.string().default(""),
        altText: z.string().max(300).optional(),
        /** Sponsor a post that already exists instead (thought leader ads): no image, no new post. */
        postUrn: z.string().regex(/^urn:li:(share|ugcPost):\d+$/).optional(),
      }).refine((a) => Boolean(a.postUrn) !== Boolean(a.imagePath), { message: "Each ad needs an image or an existing post, not both" }),
    )
    .min(1)
    .max(10),
})
export type LinkedInSpec = z.infer<typeof linkedInSpec>

/**
 * Reddit: one campaign, one ad group, ads from posts that already exist on the client's profile.
 * UNVERIFIED (2026-10-21): Reddit's v3 docs couldn't be read; field names come from an unofficial
 * client. Check a dry run's payloads against the docs before switching Reddit on.
 */
export const redditSpec = z.object({
  campaign: z.object({
    name: z.string().min(1).max(255),
    objective: z.enum(["CLICKS", "CONVERSIONS", "IMPRESSIONS", "LEAD_GENERATION", "BRAND_AWARENESS"]),
  }),
  adGroup: z.object({
    name: z.string().min(1).max(255),
    bidStrategy: z.enum(["MAXIMIZE_VOLUME", "MANUAL_BIDDING", "TARGET_CPX"]),
    bidType: z.enum(["CPC", "CPM"]),
    bid: money.optional(),
    dailyBudget: money,
    startDate: date,
    endDate: date.optional(),
    targeting: z.object({
      geolocations: z.array(z.string().min(2)).min(1),
      communities: z.array(z.string()).optional(),
      interests: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
    }),
  }),
  ads: z
    .array(z.object({ name: z.string().min(1).max(255), postId: z.string().regex(/^t3_\w+$/, "A Reddit post id (t3_…)"), clickUrl: z.url({ protocol: /^https$/ }) }))
    .min(1)
    .max(10),
})
export type RedditSpec = z.infer<typeof redditSpec>

export type BuildContext = {
  /** The client's website (clients.website); landing pages must be on it. */
  website: string | null
  /** The platform's budget for the month (client_budgets, else the account's monthly budget). */
  monthBudget: number | null
  /** What the platform has spent this month so far. */
  spentThisMonth: number
  /** Today in London, YYYY-MM-DD. */
  today: string
  /** The client the build is for: uploaded images must sit under its folder. */
  clientId?: string
}

export type Check = { ok: boolean; errors: string[]; warnings: string[] }

const hostOf = (url: string) => {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** Landing pages must be on the client's own site (or a subdomain of it). */
export function onClientSite(url: string, website: string | null) {
  const site = website ? hostOf(website) : ""
  const host = hostOf(url)
  return Boolean(site && host && (host === site || host.endsWith(`.${site}`)))
}

function daysIn(today: string) {
  const [y, m, d] = today.split("-").map(Number)
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { total, left: total - d + 1 }
}

/** The budget guard (Dean, 2026-10-21): refuse over the month's budget, warn over what's left of it. */
export function checkBudget(dailyBudget: number, ctx: BuildContext, errors: string[], warnings: string[]) {
  if (ctx.monthBudget == null) {
    warnings.push("No budget is set for this platform this month, so the budget couldn't be checked.")
    return
  }
  const { total, left } = daysIn(ctx.today)
  if (dailyBudget * total > ctx.monthBudget) errors.push(`A daily budget of ${dailyBudget} adds up to ${Math.round(dailyBudget * total)} over a month, more than this platform's ${ctx.monthBudget} for the month.`)
  else if (dailyBudget * left > ctx.monthBudget - ctx.spentThisMonth) warnings.push(`At ${dailyBudget} a day for the ${left} days left, this campaign alone would spend more than the ${Math.round(ctx.monthBudget - ctx.spentThisMonth)} left in this month's budget.`)
}

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`)

export function checkLinkedIn(raw: unknown, ctx: BuildContext): Check & { spec?: LinkedInSpec } {
  const parsed = linkedInSpec.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: issues(parsed.error), warnings: [] }
  const spec = parsed.data
  const errors: string[] = []
  const warnings: string[] = []
  const c = spec.campaign
  if (!c.targeting.include.interfaceLocales) errors.push("LinkedIn needs an interface language (interfaceLocales) in the audience.")
  if (!c.targeting.include.locations && !c.targeting.include.profileLocations) errors.push("LinkedIn needs a location in the audience.")
  if (c.targeting.include.locations && c.targeting.include.profileLocations) errors.push("Use locations or profile locations, not both.")
  if (c.objective === "LEAD_GENERATION" && c.offsiteDelivery) errors.push("LinkedIn doesn't allow the Audience Network on lead gen campaigns.")
  if (c.dailyBudget < 10) errors.push("LinkedIn's minimum daily budget is 10.")
  if (c.startDate < ctx.today) errors.push("The start date is in the past.")
  if (c.endDate && c.endDate <= c.startDate) errors.push("The end date must be after the start date.")
  if (c.bid > c.dailyBudget) errors.push("The bid is higher than the daily budget.")
  const unresolved = Object.values({ ...c.targeting.include, ...(c.targeting.exclude ?? {}) }).flat().filter((u) => u.startsWith("urn:li:unresolved:"))
  if (unresolved.length) warnings.push(`${unresolved.length} audience value${unresolved.length === 1 ? " has" : "s have"} no LinkedIn id yet (look them up before going live): ${unresolved.slice(0, 5).map((u) => u.slice(18).replace(/_/g, " ")).join(", ")}.`)
  for (const [i, ad] of spec.ads.entries()) {
    if (ad.imagePath && ctx.clientId && !ad.imagePath.startsWith(`${ctx.clientId}/`)) errors.push(`Ad ${i + 1}: that image belongs to another client.`)
    if (!ad.postUrn && !ad.landingUrl) errors.push(`Ad ${i + 1}: image ads need a landing page.`)
    else if (!ad.postUrn && !onClientSite(ad.landingUrl, ctx.website)) errors.push(`Ad ${i + 1}: the landing page isn't on ${ctx.website ?? "the client's website (none is set)"}.`)
    if (ad.postUrn) continue
    if (ad.headline.length > 70) warnings.push(`Ad ${i + 1}: LinkedIn cuts headlines over 70 characters on some screens.`)
    if (ad.commentary.length > 150) warnings.push(`Ad ${i + 1}: intro text over 150 characters is cut off behind "see more".`)
  }
  checkBudget(c.dailyBudget, ctx, errors, warnings)
  return { ok: errors.length === 0, errors, warnings, spec }
}

export function checkReddit(raw: unknown, ctx: BuildContext): Check & { spec?: RedditSpec } {
  const parsed = redditSpec.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: issues(parsed.error), warnings: [] }
  const spec = parsed.data
  const errors: string[] = []
  const warnings: string[] = ["Reddit's create calls are unverified: check the dry run's payloads against Reddit's docs before going live."]
  const g = spec.adGroup
  if (g.startDate < ctx.today) errors.push("The start date is in the past.")
  if (g.endDate && g.endDate <= g.startDate) errors.push("The end date must be after the start date.")
  if (g.bidStrategy !== "MAXIMIZE_VOLUME" && !g.bid) errors.push("Manual and target bidding need a bid.")
  for (const [i, ad] of spec.ads.entries()) {
    if (!onClientSite(ad.clickUrl, ctx.website)) errors.push(`Ad ${i + 1}: the landing page isn't on ${ctx.website ?? "the client's website (none is set)"}.`)
  }
  checkBudget(g.dailyBudget, ctx, errors, warnings)
  return { ok: errors.length === 0, errors, warnings, spec }
}
