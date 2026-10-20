/**
 * Content library settings per client (Dean, 2026-10-14; Camber only for now). The library holds a
 * client's live landing pages and guides, each with a 3-email follow-up sequence (Plan › Content
 * library). Vocabulary, the company line Claude reads, which site "Read page" may fetch and how
 * verticals map onto Master Production's `Vertical` select all live here, so adding a client is one
 * entry. Plain module: used by the server, the forms and the prompts.
 */

export const STAGES = ["Awareness", "Consideration", "Decision"] as const
export type Stage = (typeof STAGES)[number]

export const SLOTS = [1, 2, 3] as const
export type Slot = (typeof SLOTS)[number]

export type LibraryConfig = {
  /** Content types offered on the form. Stored as text, so older values still show. */
  types: readonly string[]
  /** Who a piece is written for. A sequence only sends pieces that share one of these. */
  audiences: readonly string[]
  /** The client's verticals. A piece tagged with all of them is "relevant to every vertical". */
  verticals: readonly string[]
  /** One line on the company and its buyers, at the top of every content library prompt. */
  companyLine: string
  /** Hosts "Read page" may fetch (https only, through fetchFrom's allowlist). */
  pageHosts: readonly string[]
  /**
   * Our vertical → an existing option of Master Production's `Vertical` select (no new options,
   * ever). Verticals with no option are left off the brief.
   */
  notionVerticals: Readonly<Record<string, string>>
  /** Paths on the client's site that tell us the content type ("/guides/" → Guide). */
  typeFromPath: readonly (readonly [RegExp, string])[]
}

const CAMBER: LibraryConfig = {
  types: ["Landing page", "Guide", "Tool", "Infographic", "Insight article", "Blog", "Webinar", "Case study"],
  audiences: ["Enterprise", "SMB", "PE"],
  verticals: ["Multi-specialty care", "ABA clinics", "SUD clinics", "Cardiology clinics", "ENT clinics", "PT clinics"],
  companyLine:
    "Camber is a revenue cycle management (RCM) company. Its buyers are operators of ABA, behavioral health, substance use disorder and specialty care groups, and private equity sponsors investing in them.",
  pageHosts: ["www.camber.health", "camber.health"],
  // Master Production's Vertical options (2026-10-14): SUD, Cardiology, ABA, SMB, MSP. Whether MSP
  // means Multi-specialty care, and what PT and ENT clinics map to, is pending Dean.
  notionVerticals: { "ABA clinics": "ABA", "SUD clinics": "SUD", "Cardiology clinics": "Cardiology" },
  typeFromPath: [
    [/\/tools\//, "Tool"],
    [/\/guides\//, "Guide"],
    [/\/infographic/, "Infographic"],
    [/\/insights\//, "Insight article"],
    [/\/blog\//, "Blog"],
    [/\/webinars\//, "Webinar"],
    [/\/(customers|case-stud)/, "Case study"],
    [/\/lp\//, "Landing page"],
  ],
}

const LIBRARIES: Readonly<Record<string, LibraryConfig>> = { camber: CAMBER }

/** The client's library settings, or null when the client has no content library yet. */
export function libraryConfig(slug: string): LibraryConfig | null {
  return LIBRARIES[slug.toLowerCase()] ?? null
}

/** The content type a page URL implies, from the client's path conventions, or null. */
export function typeFromUrl(cfg: LibraryConfig, url: string): string | null {
  let path = ""
  try {
    path = new URL(url).pathname
  } catch {
    return null
  }
  return cfg.typeFromPath.find(([re]) => re.test(path))?.[1] ?? null
}

/** The single Notion Vertical option for a piece, or null when it covers several or none maps. */
export function notionVertical(cfg: LibraryConfig, verticals: readonly string[]): string | null {
  return verticals.length === 1 ? (cfg.notionVerticals[verticals[0]] ?? null) : null
}

/** The next free code (C01, C02 ...) after the ones in use, archived pieces included. */
export function nextCode(codes: readonly string[]) {
  const max = codes.reduce((m, c) => Math.max(m, Number.parseInt(c.replace(/\D/g, ""), 10) || 0), 0)
  return `C${String(max + 1).padStart(2, "0")}`
}
