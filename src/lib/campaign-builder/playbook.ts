/**
 * The researched playbook's shape (ad_playbooks), how Claude's answer is cleaned, and how it reads
 * in a prompt. A plain module: the page, the tests and research.ts use it.
 */

export type PlaybookSource = { n: number; title: string; url: string; kind: string }
export type PlaybookPoint = { text: string; sources: number[]; strength: "official" | "consensus" | "practitioner" }
export type PlaybookSection = { heading: string; points: PlaybookPoint[] }
export type Playbook = { id: string; platform: string; period: string; summary: string; sections: PlaybookSection[]; sources: PlaybookSource[]; completedAt: string | null }

/** Keeps only well-formed points, http(s) sources, and source numbers that exist. */
export function cleanPlaybook(x: Record<string, unknown>): { summary: string; sections: PlaybookSection[]; sources: PlaybookSource[] } {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const sources = arr(x.sources)
    .map((s) => ({ n: Number(s.n), title: String(s.title ?? "").slice(0, 200), url: String(s.url ?? ""), kind: String(s.kind ?? "other") }))
    .filter((s) => Number.isInteger(s.n) && /^https?:\/\//.test(s.url))
    .slice(0, 60)
  const known = new Set(sources.map((s) => s.n))
  const sections = arr(x.sections)
    .slice(0, 10)
    .map((sec) => ({
      heading: String(sec.heading ?? "").slice(0, 80),
      points: arr(sec.points)
        .slice(0, 8)
        .map((p) => ({
          text: String(p.text ?? "").slice(0, 400),
          sources: (Array.isArray(p.sources) ? p.sources : []).map(Number).filter((n) => known.has(n)),
          strength: (["official", "consensus", "practitioner"].includes(String(p.strength)) ? p.strength : "practitioner") as PlaybookPoint["strength"],
        }))
        .filter((p) => p.text),
    }))
    .filter((s) => s.heading && s.points.length)
  return { summary: String(x.summary ?? "").slice(0, 800), sections, sources }
}

/** The playbook as text for the planner (sources by number, strength kept). */
export function playbookForPrompt(p: Playbook | null) {
  if (!p) return "(No researched playbook yet: use your own knowledge of current best practice and say so.)"
  const src = new Map(p.sources.map((s) => [s.n, s]))
  return [
    `Researched ${p.completedAt?.slice(0, 10) ?? p.period}. ${p.summary}`,
    ...p.sections.flatMap((s) => [`## ${s.heading}`, ...s.points.map((pt) => `- ${pt.text} [${pt.strength}${pt.sources.length ? `; ${pt.sources.map((n) => src.get(n)?.title ?? n).slice(0, 2).join("; ")}` : ""}]`)]),
  ].join("\n")
}
