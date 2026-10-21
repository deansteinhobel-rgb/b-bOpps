import type { LinkedInSpec } from "@/lib/ads-api/spec"
import type { BuilderMode } from "./presets"

/**
 * The team's playbook (Dean, 2026-10-21): rules in `ad_playbook_rules`, for every client or one.
 *   guardrail  checked by the app on every save, dry run and send (when it has a check_rule) and
 *              always given to Claude as a hard rule
 *   practice   how B&B likes campaigns built; Claude follows it and says where it did
 *   naming     how to name things; wins over the naming Claude reads from live campaigns
 * A guardrail's check_rule is { field, op, value }; the fields are the ones below. A plain module.
 */

export type RuleKind = "guardrail" | "practice" | "naming"
export type CheckRule = { field: GuardField; op: "max" | "min" | "forbid" | "require"; value?: number | string }
export type PlaybookRule = { id: string; platform: string; client_id: string | null; kind: RuleKind; modes: string[]; title: string; body: string; check_rule: CheckRule | null }

export const GUARD_FIELDS = {
  dailyBudget: "Daily budget",
  bid: "Bid",
  ads: "Number of ads",
  audienceNetwork: "Audience Network",
  objective: "Objective",
  headlineLength: "Headline length",
  introLength: "Intro text length",
  facet: "Audience facet",
} as const
export type GuardField = keyof typeof GUARD_FIELDS

/** The rules for one platform, client and view: every-client rules first, then the client's own. */
export const rulesFor = (rules: PlaybookRule[], o: { platform: string; clientId: string; mode: BuilderMode }) =>
  rules
    .filter((r) => r.platform === o.platform && (r.client_id === null || r.client_id === o.clientId) && r.modes.includes(o.mode))
    .sort((a, b) => Number(a.client_id !== null) - Number(b.client_id !== null))

/** What a guardrail's check says, in words, for the rule list. */
export function describeCheck(c: CheckRule): string {
  const f = GUARD_FIELDS[c.field] ?? c.field
  if (c.op === "max") return `${f} at most ${c.value}`
  if (c.op === "min") return `${f} at least ${c.value}`
  if (c.op === "forbid") return c.field === "audienceNetwork" ? "Audience Network off" : `${f} never ${c.value}`
  return c.field === "audienceNetwork" ? "Audience Network on" : `${f} must include ${c.value}`
}

/**
 * What the guardrails look at, from any platform's spec. Fields a platform doesn't have are left
 * out and their rules pass (a bid rule on a Meta ad set with automatic bidding, say).
 */
export type GuardFacts = {
  dailyBudget: number
  bid?: number | null
  ads: number
  audienceNetwork?: boolean | null
  objective?: string | null
  /** Every headline and intro (primary text) that the build writes, with the ad it belongs to. */
  headlines: { ad: string; text: string }[]
  intros: { ad: string; text: string }[]
  /** Audience facets the build targets (LinkedIn facet names; Meta "custom_audiences"; Google "keywords"). */
  facets: string[]
}

/** LinkedIn's spec → its facts. Sponsored posts keep their own copy, so only image ads count for text. */
export function linkedInFacts(spec: LinkedInSpec): GuardFacts {
  const c = spec.campaign
  const imageAds = spec.ads.filter((a) => !a.postUrn)
  return {
    dailyBudget: c.dailyBudget,
    bid: c.bid,
    ads: spec.ads.length,
    audienceNetwork: c.offsiteDelivery,
    objective: c.objective,
    headlines: imageAds.map((a) => ({ ad: a.name, text: a.headline })),
    intros: imageAds.map((a) => ({ ad: a.name, text: a.commentary })),
    facets: Object.entries(c.targeting.include).filter(([, v]) => v?.length).map(([k]) => k),
  }
}

/** Checks a LinkedIn spec against the guardrails that carry a check. Errors stop a save, dry run or send. */
export const checkGuardrails = (spec: LinkedInSpec, rules: PlaybookRule[]) => checkFacts(linkedInFacts(spec), rules)

/** Checks any platform's facts against the guardrails that carry a check. */
export function checkFacts(f: GuardFacts, rules: PlaybookRule[]): string[] {
  const errors: string[] = []
  for (const r of rules) {
    const k = r.check_rule
    if (r.kind !== "guardrail" || !k) continue
    const n = Number(k.value)
    const fail = (what: string) => errors.push(`${r.title}: ${what}`)
    switch (k.field) {
      case "dailyBudget":
        if (k.op === "max" && f.dailyBudget > n) fail(`the daily budget is ${f.dailyBudget}, over ${n}.`)
        if (k.op === "min" && f.dailyBudget < n) fail(`the daily budget is ${f.dailyBudget}, under ${n}.`)
        break
      case "bid":
        if (f.bid == null) break
        if (k.op === "max" && f.bid > n) fail(`the bid is ${f.bid}, over ${n}.`)
        if (k.op === "min" && f.bid < n) fail(`the bid is ${f.bid}, under ${n}.`)
        break
      case "ads":
        if (k.op === "max" && f.ads > n) fail(`${f.ads} ads, more than ${n}.`)
        if (k.op === "min" && f.ads < n) fail(`${f.ads} ads, fewer than ${n}.`)
        break
      case "audienceNetwork":
        if (f.audienceNetwork == null) break
        if (k.op === "forbid" && f.audienceNetwork) fail("the Audience Network is on.")
        if (k.op === "require" && !f.audienceNetwork) fail("the Audience Network is off.")
        break
      case "objective":
        if (f.objective == null) break
        if (k.op === "forbid" && f.objective === k.value) fail(`the objective is ${f.objective}.`)
        if (k.op === "require" && f.objective !== k.value) fail(`the objective must be ${k.value}.`)
        break
      case "headlineLength":
        if (k.op === "max") for (const h of f.headlines) if (h.text.length > n) fail(`"${h.ad}" has a ${h.text.length}-character headline (max ${n}).`)
        break
      case "introLength":
        if (k.op === "max") for (const h of f.intros) if (h.text.length > n) fail(`"${h.ad}" has ${h.text.length} characters of intro text (max ${n}).`)
        break
      case "facet": {
        const facet = String(k.value ?? "")
        const has = f.facets.includes(facet)
        if (k.op === "require" && !has) fail(`the audience needs ${facet}.`)
        if (k.op === "forbid" && has) fail(`the audience can't use ${facet}.`)
        break
      }
    }
  }
  return errors
}

/** The rules as text for Claude. */
export function rulesForPrompt(rules: PlaybookRule[]): string {
  if (!rules.length) return "(The team hasn't written any rules for this platform yet.)"
  const line = (r: PlaybookRule) => `- ${r.title}${r.body ? `: ${r.body}` : ""}${r.check_rule ? ` [checked: ${describeCheck(r.check_rule)}]` : ""}${r.client_id ? " (this client)" : ""}`
  const group = (kind: RuleKind, heading: string) => {
    const list = rules.filter((r) => r.kind === kind)
    return list.length ? [heading, ...list.map(line)] : []
  }
  return [
    ...group("guardrail", "Guardrails (never break these; the app refuses a plan that does):"),
    ...group("practice", "House practices (follow these unless the client's own rules say otherwise):"),
    ...group("naming", "Naming rules (these win over the names read from live campaigns):"),
  ].join("\n")
}
