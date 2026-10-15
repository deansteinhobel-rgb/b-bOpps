import { describe, expect, it } from "vitest"
import { sequenceBriefText, sequenceBriefTitle } from "./brief"
import type { LibraryPiece } from "./load"

const email = (slot: 1 | 2 | 3, targetId: string | null, angle: string | null, handoff = false) => ({ slot, targetId, handoff, angle, claudesPick: false, suggested: null })
const piece: LibraryPiece = {
  id: "p6",
  code: "C06",
  title: "The ABA audit wave",
  url: "https://www.camber.health/resources/insights/the-aba-audit-wave",
  type: "Insight article",
  theme: "Payer oversight",
  stage: "Awareness",
  audiences: ["Enterprise", "PE"],
  verticals: ["ABA clinics"],
  purpose: "Explains the rise in ABA payer audits.",
  seqStatus: "pending",
  reapproval: false,
  approvedAt: null,
  notionPageUrl: null,
  createdAt: "2026-10-09T00:00:00Z",
  emails: [email(1, "p9", "Audit prep lands on the billing team."), email(2, "gone", null), email(3, null, "Offer a revenue audit.", true)],
}
const byId = new Map([["p9", { title: "The hidden cost of staff turnover", url: "https://www.camber.health/x" }]])
const o = { allVerticals: ["ABA clinics", "SUD clinics"], libraryUrl: "http://localhost:3000/clients/camber/library?view=sequences" }

describe("sequence brief", () => {
  it("titles a first brief and an update", () => {
    expect(sequenceBriefTitle(piece)).toBe("Lumaux | Email sequence | The ABA audit wave")
    expect(sequenceBriefTitle({ ...piece, reapproval: true })).toBe("Lumaux | Email sequence update | The ABA audit wave")
  })

  it("lists the piece and every email, with links, angles and gaps spelled out", () => {
    const text = sequenceBriefText(piece, byId, o)
    expect(text).toBe(
      [
        'Write the 3-email follow-up sequence for people who engaged with "The ABA audit wave".',
        "",
        "Engaged with: The ABA audit wave",
        "https://www.camber.health/resources/insights/the-aba-audit-wave",
        "Insight article · Written for Enterprise, PE · ABA clinics",
        "Explains the rise in ABA payer audits.",
        "",
        "Email 1",
        "Send: The hidden cost of staff turnover (https://www.camber.health/x)",
        "Angle: Audit prep lands on the billing team.",
        "",
        "Email 2",
        "Send: content that's no longer in the library",
        "Angle: not set",
        "",
        "Email 3",
        "Send: Sales handoff (an invitation to talk to the team, no content piece)",
        "Angle: Offer a revenue audit.",
        "",
        "The content library: http://localhost:3000/clients/camber/library?view=sequences",
      ].join("\n"),
    )
  })

  it("says an update replaces the earlier brief, and calls every vertical by name", () => {
    const text = sequenceBriefText({ ...piece, notionPageUrl: "https://notion.so/old", verticals: ["ABA clinics", "SUD clinics"] }, byId, o)
    expect(text.split("\n")[0]).toBe("Updated sequence: this replaces the earlier brief (https://notion.so/old). Update the existing emails to match.")
    expect(text).toContain("· All verticals")
  })
})
