/**
 * The email sequence brief that "Approve sequence" sends to Master Production (Dean, 2026-10-14):
 * its title and the Description of Request. Notion gets properties only (no page body), so the whole
 * sequence goes in the description. Plain module: the server sends it, the Approve dialog previews it.
 */
import type { LibraryPiece } from "./load"

export const SEQUENCE_TITLE_PREFIX = "Lumaux | Email sequence | "
export const SEQUENCE_UPDATE_PREFIX = "Lumaux | Email sequence update | "

/** An update when an earlier brief went out for this piece (or it was approved before and changed). */
export const isBriefUpdate = (p: Pick<LibraryPiece, "notionPageUrl" | "reapproval">) => Boolean(p.notionPageUrl) || p.reapproval

export function sequenceBriefTitle(p: Pick<LibraryPiece, "title" | "notionPageUrl" | "reapproval">) {
  return `${isBriefUpdate(p) ? SEQUENCE_UPDATE_PREFIX : SEQUENCE_TITLE_PREFIX}${p.title.trim()}`.slice(0, 200)
}

/**
 * Everything the copywriter needs, in plain text: what they engaged with, then each email (what it
 * sends, with its link, and the angle). `byId` resolves the pieces the emails send.
 */
export function sequenceBriefText(p: LibraryPiece, byId: ReadonlyMap<string, Pick<LibraryPiece, "title" | "url">>, o: { allVerticals: readonly string[]; libraryUrl: string }) {
  const every = o.allVerticals.length > 0 && o.allVerticals.every((v) => p.verticals.includes(v))
  const about = [p.type, p.audiences.length ? `Written for ${p.audiences.join(", ")}` : "", every ? "All verticals" : p.verticals.join(", ")].filter(Boolean).join(" · ")
  const lines: string[] = []
  if (isBriefUpdate(p)) {
    lines.push(`Updated sequence: this replaces the earlier brief${p.notionPageUrl ? ` (${p.notionPageUrl})` : ""}. Update the existing emails to match.`, "")
  }
  lines.push(`Write the 3-email follow-up sequence for people who engaged with "${p.title}".`, "", `Engaged with: ${p.title}`)
  if (p.url) lines.push(p.url)
  if (about) lines.push(about)
  if (p.purpose) lines.push(p.purpose)
  for (const e of p.emails) {
    const sends = e.handoff ? "Sales handoff (an invitation to talk to the team, no content piece)" : e.targetId ? byId.get(e.targetId) : null
    lines.push("", `Email ${e.slot}`)
    if (typeof sends === "string") lines.push(`Send: ${sends}`)
    else if (sends) lines.push(`Send: ${sends.title}${sends.url ? ` (${sends.url})` : ""}`)
    else lines.push(e.targetId ? "Send: content that's no longer in the library" : "Send: not set")
    lines.push(`Angle: ${e.angle?.trim() || "not set"}`)
  }
  lines.push("", `The content library: ${o.libraryUrl}`)
  return lines.join("\n")
}
