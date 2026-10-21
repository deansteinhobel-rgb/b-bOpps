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

/** Checks a spec against the guardrails that carry a check. Errors stop a save, dry run or send. */
export function checkGuardrails(spec: LinkedInSpec, rules: PlaybookRule[]): string[] {
  const errors: string[] = []
  const c = spec.campaign
  const imageAds = spec.ads.filter((a) => !a.postUrn)
  for (const r of rules) {
    const k = r.check_rule
    if (r.kind !== "guardrail" || !k) continue
    const n = Number(k.value)
    const fail = (what: string) => errors.push(`${r.title}: ${what}`)
    switch (k.field) {
      case "dailyBudget":
        if (k.op === "max" && c.dailyBudget > n) fail(`the daily budget is ${c.dailyBudget}, over ${n}.`)
        if (k.op === "min" && c.dailyBudget < n) fail(`the daily budget is ${c.dailyBudget}, under ${n}.`)
        break
      case "bid":
        if (k.op === "max" && c.bid > n) fail(`the bid is ${c.bid}, over ${n}.`)
        if (k.op === "min" && c.bid < n) fail(`the bid is ${c.bid}, under ${n}.`)
        break
      case "ads":
        if (k.op === "max" && spec.ads.length > n) fail(`${spec.ads.length} ads, more than ${n}.`)
        if (k.op === "min" && spec.ads.length < n) fail(`${spec.ads.length} ads, fewer than ${n}.`)
        break
      case "audienceNetwork":
        if (k.op === "forbid" && c.offsiteDelivery) fail("the Audience Network is on.")
        if (k.op === "require" && !c.offsiteDelivery) fail("the Audience Network is off.")
        break
      case "objective":
        if (k.op === "forbid" && c.objective === k.value) fail(`the objective is ${c.objective}.`)
        if (k.op === "require" && c.objective !== k.value) fail(`the objective must be ${k.value}.`)
        break
      case "headlineLength":
        if (k.op === "max") for (const a of imageAds) if (a.headline.length > n) fail(`"${a.name}" has a ${a.headline.length}-character headline (max ${n}).`)
        break
      case "introLength":
        if (k.op === "max") for (const a of imageAds) if (a.commentary.length > n) fail(`"${a.name}" has ${a.commentary.length} characters of intro text (max ${n}).`)
        break
      case "facet": {
        const facet = String(k.value ?? "")
        const has = Boolean(c.targeting.include[facet]?.length)
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
