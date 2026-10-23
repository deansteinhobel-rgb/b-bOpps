import { z } from "zod"

/**
 * A campaign brief (Planning › Generate a campaign brief, Dean 2026-10-23): what Claude writes into
 * `campaign_briefs.brief`, what the page shows, and what goes to Notion and Word. A plain module so
 * the page, the generator, the exports and the tests share it.
 */

export const BRIEF_PLATFORMS = ["LinkedIn", "Google Ads", "Meta", "Reddit", "Microsoft Ads", "X", "Other"] as const

const short = (n: number) => z.string().max(n)

export const adType = z.object({
  format: short(120),
  quantity: z.number().int().min(0).max(200),
  /** Sizes, lengths, character limits, variants: what the designer and copywriter need. */
  specs: short(400).default(""),
  /** What this format is for in the campaign. */
  purpose: short(300).default(""),
})
export type AdType = z.infer<typeof adType>

export const channel = z.object({
  platform: short(40),
  /** Its job in the campaign (demand capture, retargeting, reach in the ICP). */
  role: short(300),
  objective: short(120).default(""),
  audience: short(800).default(""),
  budget: short(160).default(""),
  adTypes: z.array(adType).max(12).default([]),
})
export type Channel = z.infer<typeof channel>

export const abTest = z.object({
  name: short(160),
  platform: short(40).default(""),
  hypothesis: short(500),
  variantA: short(400),
  variantB: short(400),
  metric: short(160),
  /** How long or how much spend before calling it. */
  runFor: short(200).default(""),
})
export type AbTest = z.infer<typeof abTest>

export const brief = z.object({
  title: short(160),
  /** One plain sentence: who it reaches, with what, to get what. */
  summary: short(600),
  objective: short(800),
  audience: z.object({
    who: short(1200),
    segments: z.array(short(300)).max(8).default([]),
    exclusions: z.array(short(200)).max(8).default([]),
  }),
  messaging: z.object({
    proposition: short(600),
    pillars: z.array(short(300)).max(6).default([]),
    proofPoints: z.array(short(300)).max(8).default([]),
    offer: short(400).default(""),
    callToAction: short(160).default(""),
  }),
  channels: z.array(channel).min(1).max(7),
  abTests: z.array(abTest).max(8).default([]),
  /** Example copy so the copywriter has a starting point. */
  copyStarters: z.array(z.object({ angle: short(160), headline: short(200), body: short(600).default("") })).max(8).default([]),
  budget: z.object({ total: short(200).default(""), split: short(800).default(""), notes: short(600).default("") }),
  timeline: z.array(z.object({ phase: short(120), when: short(120), what: short(400) })).max(8).default([]),
  kpis: z.array(z.object({ metric: short(120), target: short(160), why: short(300).default("") })).max(8).default([]),
  tracking: z.array(short(300)).max(8).default([]),
  /** Where the important choices came from: Brief, Call 2026-10-02, past test, numbers, Assumption. */
  rationale: z.array(z.object({ point: short(300), source: short(120) })).max(8).default([]),
  risks: z.array(short(300)).max(6).default([]),
  /** What the team still has to decide or get from the client. */
  openQuestions: z.array(short(300)).max(6).default([]),
})
export type CampaignBrief = z.infer<typeof brief>

export const question = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  question: short(300),
  why: short(300).default(""),
  options: z.array(short(120)).max(6).default([]),
})
export type BriefQuestion = z.infer<typeof question>

export type BriefStatus = "asking" | "questions" | "writing" | "ready" | "failed"

/** Total ads across every channel, for the header and the Notion summary. */
export const totalAds = (b: CampaignBrief) => b.channels.reduce((s, c) => s + c.adTypes.reduce((t, a) => t + a.quantity, 0), 0)

/** The Notion page title: "Lumaux | Campaign Brief | {title}" (the sprint brief pattern). */
export const notionBriefTitle = (b: Pick<CampaignBrief, "title">) => `Lumaux | Campaign Brief | ${b.title.trim()}`.slice(0, 200)
