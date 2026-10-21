import { z } from "zod"
import type { LinkedInSpec } from "@/lib/ads-api/spec"
import { BUILDABLE_FORMATS, type AdFormat } from "./presets"

/**
 * What the planner returns (`campaign_build_plans.plan`) and how a reviewed plan becomes a build
 * spec (src/lib/ads-api/spec.ts). Targeting is kept as names plus LinkedIn URNs where known: names
 * come from Claude, URNs from LinkedIn's typeahead (read only) or the team. A name with no URN goes
 * into the spec as `urn:li:unresolved:…`, which a dry run shows and a live send refuses.
 * A plain module so the builder, the planner and the tests share it.
 */

const objective = z.enum(["BRAND_AWARENESS", "WEBSITE_VISIT", "ENGAGEMENT", "VIDEO_VIEW", "LEAD_GENERATION", "WEBSITE_CONVERSION"])
const cta = z.enum(["LEARN_MORE", "DOWNLOAD", "REGISTER", "SIGN_UP", "SUBSCRIBE", "REQUEST_DEMO", "APPLY", "VIEW_QUOTE", "ATTEND", "JOIN"])

/** One targeting value: what it's called, and its LinkedIn URN once known. */
export const target = z.object({ name: z.string().min(1).max(200), urn: z.string().regex(/^urn:li:[A-Za-z]+:.+$/).nullable().default(null) })
export type Target = z.infer<typeof target>

/** The LinkedIn targeting facets the builder works with (LinkedIn's own facet names). */
export const FACETS = {
  locations: "Locations",
  titles: "Job titles",
  seniorities: "Seniorities",
  jobFunctions: "Job functions",
  industries: "Industries",
  staffCountRanges: "Company size",
  skills: "Skills",
  employers: "Companies",
  audienceMatchingSegments: "Matched audiences (lists, retargeting)",
  interfaceLocales: "Interface language",
} as const
export type Facet = keyof typeof FACETS

export const planAd = z.object({
  name: z.string().min(1).max(255),
  format: z.enum(["single_image", "document", "video", "thought_leader", "carousel", "text"]),
  /** Intro text above the creative. */
  commentary: z.string().max(600).default(""),
  headline: z.string().max(200).default(""),
  landingUrl: z.string().max(2000).default(""),
  callToAction: cta.default("LEARN_MORE"),
  /** What the designer should make (image ads), or which post to sponsor (thought leader). */
  creativeBrief: z.string().max(1000).default(""),
  /** Our copy of the image (campaign-assets bucket), once someone uploads it. */
  imagePath: z.string().max(300).nullable().default(null),
  /** Thought leader / existing post: the post's URN (urn:li:share:… or urn:li:ugcPost:…). */
  postUrn: z.string().regex(/^urn:li:(share|ugcPost):\d+$/).nullable().default(null),
  /** What this ad tests against the others (one variable per ad set). */
  variable: z.string().max(200).default(""),
})
export type PlanAd = z.infer<typeof planAd>

export const plan = z.object({
  summary: z.string().max(800),
  /** The overall structure when the preset is a full campaign: one line per campaign. */
  structure: z.array(z.object({ name: z.string().max(255), purpose: z.string().max(300) })).max(8).default([]),
  group: z.object({ name: z.string().min(1).max(255), existingId: z.string().regex(/^\d+$/).nullable().default(null) }),
  campaign: z.object({
    name: z.string().min(1).max(255),
    objective,
    costType: z.enum(["CPC", "CPM"]),
    bid: z.number().positive(),
    dailyBudget: z.number().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    offsiteDelivery: z.boolean().default(false),
    /** e.g. US / en. */
    locale: z.object({ country: z.string().length(2), language: z.string().length(2) }),
  }),
  audience: z.object({
    summary: z.string().max(500),
    include: z.partialRecord(z.enum(Object.keys(FACETS) as [Facet, ...Facet[]]), z.array(target).max(200)),
    exclude: z.partialRecord(z.enum(Object.keys(FACETS) as [Facet, ...Facet[]]), z.array(target).max(200)).default({}),
  }),
  ads: z.array(planAd).min(1).max(10),
  /** Why it's planned this way, each point tied to where it came from. */
  rationale: z.array(z.object({ point: z.string().max(400), source: z.string().max(120) })).max(10).default([]),
  /** Which playbook practices and guardrails it follows. */
  practices: z.array(z.string().max(300)).max(12).default([]),
  risks: z.array(z.string().max(300)).max(6).default([]),
  /** How to judge it once live. */
  success: z.string().max(400).default(""),
})
export type Plan = z.infer<typeof plan>

export const question = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  question: z.string().max(300),
  why: z.string().max(300).default(""),
  options: z.array(z.string().max(120)).max(6).default([]),
})
export type Question = z.infer<typeof question>

export const UNRESOLVED = "urn:li:unresolved:"
const slugOf = (s: string) => s.trim().replace(/\s+/g, "_").slice(0, 120)

const urnsOf = (list: Target[] | undefined) => (list ?? []).map((t) => t.urn ?? `${UNRESOLVED}${slugOf(t.name)}`)

/** Every targeting value without a URN yet. */
export function unresolved(p: Plan): { facet: Facet; side: "include" | "exclude"; name: string }[] {
  const out: { facet: Facet; side: "include" | "exclude"; name: string }[] = []
  for (const side of ["include", "exclude"] as const) {
    for (const [facet, list] of Object.entries(p.audience[side]) as [Facet, Target[]][]) for (const t of list ?? []) if (!t.urn) out.push({ facet, side, name: t.name })
  }
  return out
}

/** Ads the app can't build yet (video, document, carousel, text): they're briefed and built in Campaign Manager. */
export const notBuildable = (p: Plan) => p.ads.filter((a) => !BUILDABLE_FORMATS.includes(a.format as AdFormat))

/**
 * A reviewed plan → the build spec for the ads the app can build. Thought leader ads sponsor an
 * existing post; image ads need an uploaded image. Ads still missing either are left out and listed.
 */
export function planToSpec(p: Plan, organizationId: string): { spec: Omit<LinkedInSpec, "ads"> & { ads: LinkedInSpec["ads"] }; leftOut: string[] } {
  const leftOut: string[] = []
  const include: Record<string, string[]> = {}
  const exclude: Record<string, string[]> = {}
  for (const [facet, list] of Object.entries(p.audience.include) as [Facet, Target[]][]) if (list?.length) include[facet] = urnsOf(list)
  for (const [facet, list] of Object.entries(p.audience.exclude) as [Facet, Target[]][]) if (list?.length) exclude[facet] = urnsOf(list)

  const ads: LinkedInSpec["ads"] = []
  for (const ad of p.ads) {
    if (ad.format === "single_image") {
      if (!ad.imagePath) {
        leftOut.push(`${ad.name}: no image uploaded yet`)
        continue
      }
      ads.push({ name: ad.name, commentary: ad.commentary, headline: ad.headline, landingUrl: ad.landingUrl, callToAction: ad.callToAction, imagePath: ad.imagePath })
    } else if (ad.format === "thought_leader") {
      if (!ad.postUrn) {
        leftOut.push(`${ad.name}: no post picked yet`)
        continue
      }
      ads.push({ name: ad.name, commentary: ad.commentary || "Sponsored post", headline: ad.headline || ad.name, landingUrl: ad.landingUrl, callToAction: ad.callToAction, imagePath: "", postUrn: ad.postUrn })
    } else {
      leftOut.push(`${ad.name}: ${ad.format.replace("_", " ")} ads are built in Campaign Manager for now`)
    }
  }

  const c = p.campaign
  return {
    spec: {
      organizationId,
      group: p.group.existingId ? { existingId: p.group.existingId } : { name: p.group.name, startDate: c.startDate },
      campaign: {
        name: c.name,
        objective: c.objective,
        costType: c.costType,
        bid: c.bid,
        dailyBudget: c.dailyBudget,
        startDate: c.startDate,
        ...(c.endDate ? { endDate: c.endDate } : {}),
        locale: c.locale,
        targeting: { include, ...(Object.keys(exclude).length ? { exclude } : {}) },
        offsiteDelivery: c.offsiteDelivery,
      },
      ads,
    },
    leftOut,
  }
}
