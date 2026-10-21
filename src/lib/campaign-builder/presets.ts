/**
 * Campaign builder presets (Dean, 2026-10-21): the starting points on the builder, split into the
 * two views. General = audience targeting by job title, function, seniority, industry, retargeting.
 * ABX = account-based: a target account or contact list (a LinkedIn matched audience) is the
 * audience, and the goal is reaching and moving the buying committee at named accounts.
 * Each preset tells Claude what kind of campaign to plan and what it must know before it can.
 * A plain module: the page, the planner and the tests use it.
 */

export type BuilderMode = "general" | "abx"
export type AdFormat = "single_image" | "document" | "video" | "thought_leader" | "carousel" | "text"

/** Formats the app can build today (the rest are planned and briefed, then built in Campaign Manager). */
export const BUILDABLE_FORMATS: AdFormat[] = ["single_image", "thought_leader"]

export const FORMAT_LABEL: Record<AdFormat, string> = {
  single_image: "Single image",
  document: "Document",
  video: "Video",
  thought_leader: "Thought leader",
  carousel: "Carousel",
  text: "Text and Spotlight",
}

export type Preset = {
  key: string
  mode: BuilderMode
  label: string
  description: string
  /** Lucide icon name, drawn by the page. */
  icon: "megaphone" | "image" | "file" | "film" | "user" | "target" | "repeat" | "building" | "sparkles"
  formats: AdFormat[]
  /** The objective to start from; Claude may argue for another. */
  objective: "BRAND_AWARENESS" | "WEBSITE_VISIT" | "ENGAGEMENT" | "VIDEO_VIEW" | "LEAD_GENERATION" | "WEBSITE_CONVERSION"
  /** What Claude is told about this kind of campaign. */
  guide: string
}

export const PRESETS: Preset[] = [
  {
    key: "full",
    mode: "general",
    label: "Plan a full LinkedIn campaign",
    description: "One brief: the group, the campaigns per format and audience, the ads.",
    icon: "megaphone",
    formats: ["single_image", "document", "thought_leader"],
    objective: "WEBSITE_CONVERSION",
    guide: "A complete campaign for one offer. Propose the structure (which formats and audiences get their own campaign), then build the first campaign in detail.",
  },
  {
    key: "lead_gen_image",
    mode: "general",
    label: "Single image lead gen",
    description: "Image ads with a LinkedIn lead form, cold job title targeting.",
    icon: "image",
    formats: ["single_image"],
    objective: "LEAD_GENERATION",
    guide: "Lead gen form campaign with 3-4 single image ads testing one variable (hook or visual). No Audience Network.",
  },
  {
    key: "site_conversions",
    mode: "general",
    label: "Website conversions",
    description: "Drive trials or demos on the client's site, measured by the Insight Tag.",
    icon: "sparkles",
    formats: ["single_image"],
    objective: "WEBSITE_CONVERSION",
    guide: "Website conversion campaign to the client's own landing page. Needs the conversion it optimizes for.",
  },
  {
    key: "document",
    mode: "general",
    label: "Document ads",
    description: "A guide or report as a swipeable document, gated or ungated.",
    icon: "file",
    formats: ["document"],
    objective: "LEAD_GENERATION",
    guide: "Document ads for a content piece (preview pages ungated, the rest behind a lead form when gated). The app plans and briefs these; the document is uploaded in Campaign Manager for now.",
  },
  {
    key: "thought_leader",
    mode: "general",
    label: "Thought leader ads",
    description: "Sponsor posts from the client's founders, team or customers.",
    icon: "user",
    formats: ["thought_leader"],
    objective: "ENGAGEMENT",
    guide: "Sponsor existing posts by people (the post's URN is needed). Pick posts that already earned engagement organically.",
  },
  {
    key: "retargeting",
    mode: "general",
    label: "Retargeting",
    description: "Site visitors and engagers, moved from content to a conversion offer.",
    icon: "repeat",
    formats: ["single_image"],
    objective: "WEBSITE_CONVERSION",
    guide: "Retargeting of website visitors (Insight Tag audience) and ad or page engagers, with a bottom-of-funnel offer. Needs the matched audiences to use.",
  },
  {
    key: "abx_awareness",
    mode: "abx",
    label: "Target account awareness",
    description: "Reach the buying committee at named accounts with point-of-view content.",
    icon: "building",
    formats: ["single_image", "document"],
    objective: "BRAND_AWARENESS",
    guide: "ABX: a company or contact list (matched audience) layered with job functions or seniorities for the buying committee. Optimize for reach and frequency across accounts, judged on account engagement, not cost per lead.",
  },
  {
    key: "abx_committee",
    mode: "abx",
    label: "Buying committee content",
    description: "Document and image ads per persona at target accounts.",
    icon: "target",
    formats: ["document", "single_image"],
    objective: "ENGAGEMENT",
    guide: "ABX: one campaign per persona (e.g. finance, operations, IT) on the same account list, each with content written for that persona's problem.",
  },
  {
    key: "abx_retarget",
    mode: "abx",
    label: "Retarget engaged accounts",
    description: "Accounts that engaged get a conversion offer.",
    icon: "repeat",
    formats: ["single_image"],
    objective: "WEBSITE_CONVERSION",
    guide: "ABX: accounts on the list that engaged (ad engagers, site visitors) get a demo, assessment or meeting offer.",
  },
  {
    key: "abx_thought_leader",
    mode: "abx",
    label: "Thought leaders to target accounts",
    description: "Executives' posts sponsored to the account list.",
    icon: "user",
    formats: ["thought_leader"],
    objective: "ENGAGEMENT",
    guide: "ABX: sponsor executives' posts to the target account list so the buying committee sees people, not just the brand.",
  },
]

export const presetsFor = (mode: BuilderMode) => PRESETS.filter((p) => p.mode === mode)
export const presetByKey = (key: string) => PRESETS.find((p) => p.key === key) ?? null

/**
 * Whether a live campaign belongs in the ABX view: account-based by its name (ABM, ABX, target or
 * prospect lists, hot account lists). Clients with segment rules (Camber) say the same thing.
 */
export const ABX_NAME = /\b(AB[MX]|account[- ]?based|target[- ](account|contact)?[- ]?list|prospect[- ]lists?|hot[- ][a-z-]*lists?|matched[- ]?audience)/i
export const isAbxCampaign = (name: string | null | undefined) => ABX_NAME.test((name ?? "").replace(/[_]/g, " "))
