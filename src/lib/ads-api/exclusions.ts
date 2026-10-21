import { knownUrn } from "@/lib/campaign-builder/plan-schema"
import type { RuleKey } from "@/lib/insights/rules"

/**
 * Exclusions from Recommendations (Dean, 2026-10-21): add seniorities or companies to a LinkedIn
 * campaign's exclusions. LinkedIn takes the whole targetingCriteria on update, so the campaign's
 * current targeting is read from LinkedIn first, its include side is kept exactly as it is, and only
 * the one exclude facet gains values. Nothing is ever removed from the targeting here.
 * A plain module so the tests can use it.
 */
export const EXCLUDE_FACETS = {
  seniorities: "urn:li:adTargetingFacet:seniorities",
  employers: "urn:li:adTargetingFacet:employers",
} as const
export type ExcludeFacet = keyof typeof EXCLUDE_FACETS

export const FACET_WORDS: Record<ExcludeFacet, { one: string; many: string }> = {
  seniorities: { one: "seniority", many: "seniorities" },
  employers: { one: "company", many: "companies" },
}

/** Which recommendations can be actioned as a LinkedIn exclusion, and on which facet. */
export function exclusionFor(rule: RuleKey): ExcludeFacet | null {
  if (rule === "li_junior") return "seniorities"
  if (rule === "li_not_icp" || rule === "li_own_company" || rule === "li_companies") return "employers"
  return null
}

export const seniorityUrn = (name: string) => knownUrn("seniorities", name)

export type Exclusion = { urn: string; name: string }
type Criteria = { include?: unknown; exclude?: { or?: Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)

/** Every value a facet appears with on the include side (any and/or nesting). */
function includedValues(include: unknown, facetUrn: string): Set<string> {
  const out = new Set<string>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!isObject(v)) return
    for (const [k, inner] of Object.entries(v)) {
      if (k === facetUrn && Array.isArray(inner)) inner.forEach((x) => typeof x === "string" && out.add(x))
      else walk(inner)
    }
  }
  walk(include)
  return out
}

/**
 * The campaign's targeting with `values` added to one exclude facet. Refuses when the current
 * targeting wasn't read (no include side: replacing it would wipe the audience), when the campaign
 * targets one of the values on purpose, or when there's nothing new to add.
 */
export function withExclusions(current: unknown, facet: ExcludeFacet, values: Exclusion[]) {
  if (!isObject(current) || !isObject(current.include)) throw new Error("Couldn't read the campaign's current targeting from LinkedIn, so nothing can be changed.")
  const criteria = current as Criteria
  const facetUrn = EXCLUDE_FACETS[facet]
  const targeted = includedValues(criteria.include, facetUrn)
  const clash = values.filter((v) => targeted.has(v.urn))
  if (clash.length) throw new Error(`The campaign targets ${clash.map((v) => v.name).join(", ")} on purpose. Change that in Campaign Manager first.`)

  const exclude = isObject(criteria.exclude) ? criteria.exclude : {}
  const or = isObject(exclude.or) ? exclude.or : {}
  const existing = Array.isArray(or[facetUrn]) ? (or[facetUrn] as unknown[]).filter((x): x is string => typeof x === "string") : []
  const have = new Set(existing)
  const added = values.filter((v, n) => !have.has(v.urn) && values.findIndex((w) => w.urn === v.urn) === n)
  const already = values.filter((v) => have.has(v.urn))
  if (!added.length) throw new Error(`Already excluded on this campaign: ${already.map((v) => v.name).join(", ")}.`)

  const targeting = { ...criteria, exclude: { ...exclude, or: { ...or, [facetUrn]: [...existing, ...added.map((v) => v.urn)] } } }
  return { targeting, added, already }
}

/** The before → after lines for the log and the confirmation. */
export function describeExclusion(facet: ExcludeFacet, added: Exclusion[], already: Exclusion[]): string[] {
  const w = FACET_WORDS[facet]
  const lines = [`Excluded ${w.many}: + ${added.map((v) => v.name).join(", ")}`]
  if (already.length) lines.push(`Already excluded: ${already.map((v) => v.name).join(", ")}`)
  return lines
}

/** The include side must be the same before and after: the one thing the patch can't touch. */
export const sameInclude = (a: unknown, b: unknown) => JSON.stringify((a as Criteria | null)?.include ?? null) === JSON.stringify((b as Criteria | null)?.include ?? null)

/** A company name as LinkedIn's typeahead returns it, matched to the one Windsor gave us. */
export function matchCompany(name: string, results: { name: string; urn: string }[]) {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
  const orgs = results.filter((r) => /^urn:li:organization:\d+$/.test(r.urn))
  const exact = orgs.filter((r) => norm(r.name) === norm(name))
  return { urn: exact.length === 1 ? exact[0].urn : null, candidates: orgs.slice(0, 6) }
}
