/**
 * "What we need" for a test brief, per platform (Dean, 2026-09-30). A plain module: the brief
 * pop-up uses it to draft the comment, and the server uses it for Description of Request.
 */
export type NeedsPlatform = "linkedin" | "meta" | "google_ads" | "bing" | "reddit" | "x"

type Format = { key: string; label: string; design: boolean; template?: "search" | "display" }

export const TEMPLATES = {
  search: "https://docs.google.com/spreadsheets/d/1JAGxnxI5fl8o6dh5T52GcTSFL8D7C4KNcTRDYNNstVE/edit?gid=383199742#gid=383199742",
  display: "https://docs.google.com/spreadsheets/d/15PvtrZTnNjdp6a1hZ9nm_BbQNvhzKvW-iyZ1JPeM71U/edit?gid=99791921#gid=99791921",
} as const

const SOCIAL: Format[] = [
  { key: "static", label: "Single Image Static", design: true },
  { key: "gif", label: "GIF", design: true },
  { key: "video", label: "Video", design: true },
]
const SEARCH: Format[] = [
  { key: "search", label: "Search Ad", design: false, template: "search" },
  { key: "display", label: "Display Ad", design: true, template: "display" },
  { key: "pmax", label: "Performance Max", design: true },
]

/**
 * Formats per platform. `design: false` = copy only: conversation ads are text, thought leader
 * ads promote a person's post, and search ads are text.
 */
export const NEEDS: Record<NeedsPlatform, { label: string; formats: Format[]; leadForm: boolean; quantities: boolean }> = {
  linkedin: {
    label: "LinkedIn",
    formats: [
      { key: "single_image", label: "Single Image Ad", design: true },
      { key: "document", label: "Document Ad", design: true },
      { key: "conversation", label: "Conversation Ad", design: false },
      { key: "thought_leader", label: "Thought Leader Ad", design: false },
    ],
    leadForm: true,
    quantities: true,
  },
  meta: { label: "Meta", formats: SOCIAL, leadForm: true, quantities: true },
  google_ads: { label: "Google Ads", formats: SEARCH, leadForm: false, quantities: false },
  bing: { label: "Microsoft Ads", formats: SEARCH, leadForm: false, quantities: false },
  reddit: { label: "Reddit", formats: SOCIAL, leadForm: true, quantities: true },
  x: { label: "X", formats: SOCIAL, leadForm: true, quantities: true },
}

export const NEEDS_PLATFORMS = Object.keys(NEEDS) as NeedsPlatform[]

export type Needs = {
  platform: NeedsPlatform
  /** Format key → how many (1 when the platform doesn't ask for quantities). */
  formats: Record<string, number>
  leadForm: boolean
  leadFormQty: number
  notes: string
  designNotes: string
}

/** The platform to start on: the test's own, or one named in its title ("Several platforms" tests). */
export function guessPlatform(platform: string | null, title: string): NeedsPlatform {
  if (platform && platform in NEEDS) return platform as NeedsPlatform
  const t = title.toLowerCase()
  if (/\breddit\b/.test(t)) return "reddit"
  if (/\b(bing|microsoft)\b/.test(t)) return "bing"
  if (/\b(twitter|x ads?)\b|\bon x\b/.test(t)) return "x"
  if (/\bmeta|facebook|instagram\b/.test(t)) return "meta"
  if (/\bgoogle\b/.test(t)) return "google_ads"
  return "linkedin"
}

export const emptyNeeds = (platform: NeedsPlatform): Needs => ({ platform, formats: {}, leadForm: false, leadFormQty: 1, notes: "", designNotes: "" })

/** Only the formats that belong to the platform, with sane quantities. */
export function cleanNeeds(n: Needs): Needs {
  const def = NEEDS[n.platform]
  const formats: Record<string, number> = {}
  for (const f of def.formats) {
    const q = n.formats[f.key]
    if (q) formats[f.key] = def.quantities ? Math.min(50, Math.max(1, Math.round(q))) : 1
  }
  const leadForm = def.leadForm && n.leadForm
  return { ...n, formats, leadForm, leadFormQty: leadForm ? Math.min(20, Math.max(1, Math.round(n.leadFormQty))) : 0, notes: n.notes.trim(), designNotes: n.designNotes.trim() }
}

/**
 * "What we need from copy / design" as the team writes it. Notes are left out when empty. Search
 * and display ads carry their template link.
 */
export function needsText(raw: Needs): string {
  const n = cleanNeeds(raw)
  const def = NEEDS[n.platform]
  const chosen = def.formats.filter((f) => n.formats[f.key])
  // A template link goes once: under design for display ads, under copy for search ads.
  const item = (f: Format, withTemplate: boolean) => {
    const qty = def.quantities ? `${n.formats[f.key]} x ` : ""
    const template = withTemplate && f.template ? ` (template: ${TEMPLATES[f.template]})` : ""
    return `• ${qty}${f.label}${template}`
  }
  const copy = chosen.map((f) => item(f, !f.design))
  if (n.leadForm) copy.push(`• ${n.leadFormQty} x Lead form copy`)
  const design = chosen.filter((f) => f.design).map((f) => item(f, true))
  const parts = [`Platform: ${def.label}`]
  if (copy.length) parts.push(`What we need from copy:\n${copy.join("\n")}`)
  if (n.notes) parts.push(`Notes: ${n.notes}`)
  if (design.length) parts.push(`What we need from design:\n${design.join("\n")}`)
  if (n.designNotes) parts.push(`Notes for design: ${n.designNotes}`)
  return parts.join("\n\n")
}

export const hasNeeds = (n: Needs) => Object.keys(cleanNeeds(n).formats).length > 0 || cleanNeeds(n).leadForm
