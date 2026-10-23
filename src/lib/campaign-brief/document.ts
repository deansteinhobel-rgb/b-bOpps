import type { CampaignBrief } from "./schema"
import { totalAds } from "./schema"

/**
 * A campaign brief as a plain list of blocks, the one layout the page's Word export and the Notion
 * page share (Dean, 2026-10-23). Text may carry **bold** lead-ins, which each writer turns into its
 * own formatting.
 */
export type DocBlock =
  | { t: "h1" | "h2" | "h3" | "p" | "bullet"; text: string }
  | { t: "table"; head: string[]; rows: string[][] }

export type DocMeta = { clientName: string; createdOn: string; link?: string | null }

const has = (s: string | null | undefined): s is string => Boolean(s?.trim())

export function briefBlocks(b: CampaignBrief, meta: DocMeta): DocBlock[] {
  const out: DocBlock[] = []
  const h2 = (text: string) => out.push({ t: "h2", text })
  const p = (text: string | null | undefined) => has(text) && out.push({ t: "p", text: text.trim() })
  const lead = (label: string, text: string | null | undefined) => has(text) && out.push({ t: "p", text: `**${label}:** ${text.trim()}` })
  const bullets = (items: string[]) => items.filter(has).forEach((text) => out.push({ t: "bullet", text: text.trim() }))

  out.push({ t: "h1", text: b.title })
  p(`${meta.clientName} · ${meta.createdOn} · ${totalAds(b)} ads across ${b.channels.length} channel${b.channels.length === 1 ? "" : "s"}`)
  p(`**${b.summary.trim()}**`)

  h2("Objective")
  p(b.objective)

  h2("Audience")
  p(b.audience.who)
  bullets(b.audience.segments)
  if (b.audience.exclusions.length) lead("Exclude", b.audience.exclusions.join("; "))

  h2("Messaging")
  lead("Proposition", b.messaging.proposition)
  if (b.messaging.pillars.length) {
    p("**Message pillars**")
    bullets(b.messaging.pillars)
  }
  if (b.messaging.proofPoints.length) {
    p("**Proof points**")
    bullets(b.messaging.proofPoints)
  }
  lead("Offer", b.messaging.offer)
  lead("Call to action", b.messaging.callToAction)

  h2("Channels and ad types")
  for (const c of b.channels) {
    out.push({ t: "h3", text: c.platform })
    lead("Role", c.role)
    lead("Objective", c.objective)
    lead("Audience", c.audience)
    lead("Budget", c.budget)
    if (c.adTypes.length) out.push({ t: "table", head: ["Ad type", "Quantity", "Specs", "Purpose"], rows: c.adTypes.map((a) => [a.format, String(a.quantity), a.specs, a.purpose]) })
  }

  if (b.abTests.length) {
    h2("A/B tests")
    b.abTests.forEach((x, i) => {
      out.push({ t: "h3", text: `${i + 1}. ${x.name}${has(x.platform) ? ` (${x.platform})` : ""}` })
      bullets([`**Hypothesis:** ${x.hypothesis}`, `**A:** ${x.variantA}`, `**B:** ${x.variantB}`, `**Judge on:** ${x.metric}`, has(x.runFor) ? `**Run for:** ${x.runFor}` : ""])
    })
  }

  if (b.copyStarters.length) {
    h2("Copy starters")
    bullets(b.copyStarters.map((c) => `**${c.angle}:** ${c.headline}${has(c.body) ? `. ${c.body}` : ""}`))
  }

  if (has(b.budget.total) || has(b.budget.split) || has(b.budget.notes)) {
    h2("Budget")
    lead("Total", b.budget.total)
    lead("Split", b.budget.split)
    p(b.budget.notes)
  }

  if (b.timeline.length) {
    h2("Timeline")
    out.push({ t: "table", head: ["Phase", "When", "What"], rows: b.timeline.map((x) => [x.phase, x.when, x.what]) })
  }

  if (b.kpis.length) {
    h2("KPIs")
    out.push({ t: "table", head: ["Metric", "Target", "Why"], rows: b.kpis.map((k) => [k.metric, k.target, k.why]) })
  }

  if (b.tracking.length) {
    h2("Tracking")
    bullets(b.tracking)
  }
  if (b.rationale.length) {
    h2("Why this plan")
    bullets(b.rationale.map((r) => `${r.point} (${r.source})`))
  }
  if (b.risks.length) {
    h2("Risks")
    bullets(b.risks)
  }
  if (b.openQuestions.length) {
    h2("Still to decide")
    bullets(b.openQuestions)
  }
  if (has(meta.link)) p(`Made in Lumaux: ${meta.link}`)
  return out
}

/** File name for the Word export: "DNSFilter campaign brief - MSP partners.docx". */
export function docxFileName(clientName: string, title: string) {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim()
  return `${clean(clientName)} campaign brief - ${clean(title)}`.slice(0, 120) + ".docx"
}

/** "**Label:** text" split into runs, for writers that format bold themselves (Word). */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(/\*\*([^*\n]+?)\*\*/g)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false })
    out.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false })
  return out
}
