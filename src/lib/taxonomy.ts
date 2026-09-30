/**
 * Shared labels for comparing clients, tests and ads (Dean, 2026-09-30: "the data is the selling
 * point"). The goal is a cross-client view of what works per industry, sales motion, lever and
 * creative, so every label comes from a fixed list rather than free text. Plain module: used by the
 * server, the forms and Claude's classifiers. Keys are stored in the database (check constraints
 * mirror the short lists); labels are for people.
 */

// ── Clients ────────────────────────────────────────────────────────────────
export const INDUSTRIES = [
  "Cybersecurity",
  "IT / infrastructure",
  "Data & AI",
  "Developer tools",
  "Procurement / spend",
  "Finance / fintech",
  "Legal tech",
  "HR / people",
  "Marketing / sales tech",
  "Construction / property",
  "Healthcare",
  "Manufacturing / industrial",
  "Supply chain / logistics",
  "Education",
  "Professional services",
  "Public sector",
  "Other",
] as const

export const SALES_MOTIONS = {
  plg: { label: "Product-led", hint: "People sign up or start a trial themselves." },
  sales_led: { label: "Sales-led", hint: "Leads go to sales for a demo or call." },
  hybrid: { label: "Hybrid", hint: "Both: self-serve trials and a sales team." },
} as const
export type SalesMotion = keyof typeof SALES_MOTIONS

/** Annual contract value of a typical new customer, in US dollars (roughly converted for other currencies). */
export const DEAL_SIZE_BANDS = {
  under_10k: "Under $10k",
  "10k_50k": "$10k–50k",
  "50k_150k": "$50k–150k",
  "150k_500k": "$150k–500k",
  over_500k: "$500k+",
} as const
export type DealSizeBand = keyof typeof DEAL_SIZE_BANDS

/** Where the client sells (target markets, not where they're based). Several allowed. */
export const REGIONS = {
  na: "North America",
  uk: "UK & Ireland",
  europe: "Europe",
  mea: "Middle East & Africa",
  apac: "Asia Pacific",
  latam: "Latin America",
} as const
export type Region = keyof typeof REGIONS

// ── Sprint tests ───────────────────────────────────────────────────────────
/** The one thing a test changes. Chosen when it's planned; Claude labels older tests. */
export const LEVERS = {
  audience: { label: "Audience / targeting", hint: "Who sees the ads: job titles, companies, keywords, lookalikes, exclusions." },
  message: { label: "Message / angle", hint: "What the ad says: a new hook, pain point or proof point." },
  creative: { label: "Creative / design", hint: "How it looks: new visuals or video for the same message." },
  format: { label: "Ad format", hint: "Document vs single image, Thought Leader, conversation, carousel…" },
  offer: { label: "Offer / content piece", hint: "What we give or ask for: a report, guide, demo, trial, webinar." },
  landing_page: { label: "Landing page / form", hint: "Where the click goes: page, lead form, fields." },
  bidding: { label: "Bidding / budget", hint: "Bid strategy, budget split, pacing." },
  structure: { label: "Campaign structure", hint: "How campaigns and ad groups are split, consolidated or sequenced." },
  channel: { label: "New platform / placement", hint: "A platform or placement we haven't used for this client." },
  measurement: { label: "Tracking / measurement", hint: "Conversion setup, attribution, what we count." },
} as const
export type Lever = keyof typeof LEVERS
export const LEVER_KEYS = Object.keys(LEVERS) as Lever[]
export const isLever = (v: unknown): v is Lever => typeof v === "string" && v in LEVERS

// ── Ads ────────────────────────────────────────────────────────────────────
export const AD_FORMATS = [
  "Single image",
  "Carousel",
  "Video",
  "Document",
  "Conversation / message",
  "Thought Leader",
  "Text / search",
  "Display",
  "Performance Max",
  "Event",
  "Other",
] as const

/** What the content is. The same list content ideas uses. */
export const AD_CONTENT_TYPES = ["Whitepaper", "Guide", "Report", "Case study", "Webinar", "Event", "Blog", "Checklist", "Assessment / tool", "Calculator", "Demo / trial", "Product", "Video", "Thought leadership", "Other"] as const

/** What the ad asks people to do. */
export const AD_OFFERS = ["Download", "Book a demo", "Free trial / sign up", "Register (webinar or event)", "Contact sales", "Get a quote / pricing", "Read / learn more", "Subscribe", "Other"] as const

/** The way in: why someone would stop scrolling. */
export const AD_HOOKS = ["Pain point", "Outcome / ROI", "Stat / data", "Customer proof", "Product feature", "Question / curiosity", "News / urgency", "Point of view", "Comparison", "Other"] as const

/** What the label was worked out from: the image, the ad copy, or only its name. */
export const LABEL_BASIS = ["image", "copy", "name"] as const

// ── Conversion events ──────────────────────────────────────────────────────
/**
 * Standard result tiers, so "a result" means the same across clients (DNSFilter counts MQLs,
 * Camber leads). Each client's conversion and lead fields are mapped to one tier by an admin.
 */
export const RESULT_TIERS = {
  micro: { label: "Micro-conversion", hint: "Engagement or a page visit, not a person handing over details." },
  lead: { label: "Lead", hint: "Someone filled in a form: download, lead gen form, newsletter." },
  mql: { label: "MQL", hint: "A lead that marketing has qualified (e.g. an MQL event from the CRM)." },
  trial: { label: "Free trial / sign-up", hint: "A product sign-up or trial started." },
  demo: { label: "Demo / meeting request", hint: "Asked to talk to sales or book a demo." },
  sql: { label: "SQL", hint: "Sales accepted or qualified it." },
  opportunity: { label: "Opportunity", hint: "A deal was opened in the CRM." },
  customer: { label: "Customer", hint: "Closed won / purchase." },
  mixed: { label: "Mixed", hint: "Several kinds counted together (e.g. Google Ads' primary conversions) and we can't split them." },
} as const
export type ResultTier = keyof typeof RESULT_TIERS
export const isResultTier = (v: unknown): v is ResultTier => typeof v === "string" && v in RESULT_TIERS

/**
 * A hint for the admin page only, never saved on its own: lead gen form fields are leads, and a
 * field named as an MQL event is an MQL. Everything else (website conversions, Google's primary
 * conversions) depends on how the client set it up, so an admin picks.
 */
export function suggestTier(platform: string, field: string): ResultTier | null {
  if (/marketingqualifiedlead|_mql/i.test(field)) return "mql"
  if ((platform === "linkedin" && field === "oneclickleads") || (platform === "meta" && field === "actions_lead")) return "lead"
  return null
}

/** The lever a test made from an "Optimise now" insight pulls, by rule. Unclear ones are left for Claude. */
const INSIGHT_LEVERS: Record<string, Lever> = {
  keywords: "audience",
  negatives: "audience",
  icp_terms: "audience",
  li_companies: "audience",
  li_not_icp: "audience",
  li_own_company: "audience",
  li_junior: "audience",
  li_weak_segments: "audience",
  li_strong_segments: "audience",
  meta_lookalike: "audience",
  budget_capped: "bidding",
  rank_lost: "bidding",
  meta_learning: "structure",
  meta_placements: "channel",
  landing_pages: "landing_page",
}
export const leverForInsight = (rule: string): Lever | null => INSIGHT_LEVERS[rule] ?? null

/** The lever a test planned from a content idea pulls, by the kind of idea. */
const IDEA_LEVERS: Record<string, Lever> = { new_content: "offer", repurpose: "format", new_angle: "message", new_audience: "audience", new_format: "format" }
export const leverForIdea = (kind: string): Lever | null => IDEA_LEVERS[kind] ?? null
