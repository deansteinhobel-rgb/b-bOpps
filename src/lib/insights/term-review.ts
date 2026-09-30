import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { claude } from "@/lib/ai/claude"
import { money, oneDp, withSymbols } from "@/lib/format"
import { briefForPrompt } from "@/lib/knowledge/brief"
import { campaignBreakdowns } from "@/lib/metrics/breakdowns"
import { cleanTerm, MATCH_TYPES, type MatchType } from "@/lib/windsor/negatives"
import { MATCHING_PRIMER } from "./search-matching"
import { checkRoot, type KeywordVerdict, type RootNegative, type SeenTerm, type TermReview, type TermVerdict } from "./term-review-rules"

/**
 * "Check against the ICP" on a Google campaign's search terms (Dean, 2026-09-30). Claude reads the
 * client brief (who they sell to, what they sell, must-knows), the campaign's top search terms and
 * keywords (30 days) and how Google's matching works (AI Max included), and says which terms to
 * exclude, which shorter negatives would block a whole off-ICP theme, and which keywords look worth
 * pausing. No web tools. Stored in term_reviews (server-written, never deleted). Suggestions only:
 * the team pushes negatives through the usual dry-run-gated push, and changes keywords by hand.
 */
export const TERM_REVIEW_MODEL = "claude-opus-5-5"
const MAX_TERMS = 300
const MAX_KEYWORDS = 150

const SUBMIT = {
  name: "submit_term_review",
  description: "Submit your review of this campaign's search terms. Call it exactly once, at the end.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One sentence: how well the searches this campaign buys fit the client's ICP, with the money involved (currency symbols)." },
      points: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" }, description: "2-4 short points (under 30 words each): the off-ICP themes, how matching is behaving (e.g. how much comes through AI Max or broad), and anything to change in Google Ads settings (brand exclusions, search term matching per ad group)." },
      terms: {
        type: "array",
        description: "ONLY the listed search terms to exclude or watch. Leave out every term that fits (most of them). Copy the term exactly as listed.",
        items: { type: "object", properties: { term: { type: "string" }, verdict: { type: "string", enum: ["exclude", "watch"] }, reason: { type: "string", description: "Under 15 words, tied to the ICP or the offer." } }, required: ["term", "verdict", "reason"] },
      },
      roots: {
        type: "array",
        maxItems: 10,
        description: "Up to 10 shorter negatives that block a whole off-ICP theme (e.g. phrase \"jobs\", phrase \"free download\"). Only where 2+ listed terms share it and none of the converting terms contain it.",
        items: { type: "object", properties: { text: { type: "string" }, match_type: { type: "string", enum: ["PHRASE", "EXACT", "BROAD"] }, reason: { type: "string", description: "Under 15 words." } }, required: ["text", "match_type", "reason"] },
      },
      keywords: {
        type: "array",
        description: "ONLY keywords worth pausing (spend with no results and off-ICP, or bringing in mostly off-ICP searches) or reviewing. Leave out the rest.",
        items: { type: "object", properties: { keyword: { type: "string" }, verdict: { type: "string", enum: ["pause", "review"] }, reason: { type: "string", description: "Under 15 words." } }, required: ["keyword", "verdict", "reason"] },
      },
    },
    required: ["headline", "points", "terms", "roots", "keywords"],
  },
}

const system = (today: string) => `You are a senior B2B paid search specialist at Bordeaux & Burgundy. Today is ${today}. You're checking which searches one Google Ads campaign is paying for against the client's ideal customer profile (ICP) and offer, so the team can add negative keywords.

${MATCHING_PRIMER}

How to judge a search term:
- "exclude": plainly not someone the client could sell to or doesn't sell to: job and salary searches, students and courses, free/DIY/consumer intent the client can't serve, a different product or industry that shares a word, a competitor's own login or support, a location or audience the brief rules out.
- "watch": could go either way, or fits but costs a lot with no results yet. Say why.
- Leave out anything that fits. A term that converted is almost never "exclude" (say why if it is).
- Read the campaign's name and goal first: on a brand campaign, brand searches are the point; on a competitor campaign, competitor names are the point.
- The brief and the team's must-knows win over your own view of the market. Where the brief doesn't say, be careful and use "watch".
- Currency is always a symbol ($, £, €). Never invent numbers.`

type Campaign = { id: string; name: string; goal?: string | null }

export async function writeTermReview(db: SupabaseClient, reader: SupabaseClient, o: { clientId: string; clientName: string; currency: string; target: number | null; campaign: Campaign; from: string; to: string; today: string; requestedBy: string }): Promise<TermReview> {
  const m = (v: number) => money(v, o.currency)
  const data = await campaignBreakdowns(reader, o.clientId, "google_ads", o.campaign.id, o.from, o.to)
  if (data.kind !== "google") throw new Error("Not a Google campaign.")

  // One line per search term (across ad groups and match sources), biggest spend first.
  const byTerm = new Map<string, { text: string; spend: number; clicks: number; results: number; sources: Set<string>; groups: Set<string> }>()
  for (const t of data.terms) {
    const key = cleanTerm(t.dim1)
    const e = byTerm.get(key) ?? { text: key, spend: 0, clicks: 0, results: 0, sources: new Set<string>(), groups: new Set<string>() }
    e.spend += t.m.spend
    e.clicks += t.m.clicks
    e.results += t.m.results
    e.sources.add(t.dim2)
    e.groups.add(t.groupName ?? t.groupId)
    byTerm.set(key, e)
  }
  const all = [...byTerm.values()].sort((a, b) => b.spend - a.spend)
  const sent = all.slice(0, MAX_TERMS)
  if (!sent.length) throw new Error("No search terms in the last 30 days to check.")
  const totalSpend = all.reduce((a, t) => a + t.spend, 0)
  const aiMaxSpend = data.terms.filter((t) => t.dim2 === "AI_MAX").reduce((a, t) => a + t.m.spend, 0)
  const keywords = [...data.keywords].sort((a, b) => b.m.spend - a.m.spend).slice(0, MAX_KEYWORDS)

  const brief = await briefForPrompt(o.clientId)
  const context = [
    brief || "(No client brief yet. Judge only what's plainly off-offer, and use \"watch\" for the rest.)",
    ``,
    `# The campaign`,
    `Client: ${o.clientName}. Campaign: ${o.campaign.name}${o.campaign.goal ? ` (goal: ${o.campaign.goal})` : ""}. Target cost per result: ${o.target === null ? "none set" : m(o.target)}.`,
    `Search terms ${o.from} to ${o.to}: ${all.length} terms, ${m(totalSpend)} spend on visible terms${aiMaxSpend ? `, of which ${m(aiMaxSpend)} (${Math.round((aiMaxSpend / Math.max(totalSpend, 1)) * 100)}%) came through AI Max` : ", none through AI Max"}.`,
    ``,
    `# Search terms (top ${sent.length} by spend: term | match sources | ad groups | spend | clicks | results)`,
    ...sent.map((t) => `- ${t.text} | ${[...t.sources].join(", ")} | ${[...t.groups].slice(0, 3).join(", ")} | ${m(t.spend)} | ${t.clicks} | ${oneDp(t.results)}`),
    ``,
    `# Keywords (top ${keywords.length} by spend: keyword | match type | ad group | spend | clicks | results | quality score)`,
    ...(keywords.length ? keywords.map((k) => `- ${k.dim1} | ${k.dim2} | ${k.groupName ?? k.groupId} | ${m(k.m.spend)} | ${k.m.clicks} | ${oneDp(k.m.results)} | ${(k.extra?.quality_score as number | null) ?? "–"}`) : ["(none reported)"]),
  ].join("\n")

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${context}\n\nCheck these search terms and keywords against the ICP, then call submit_term_review.` }]
  const usage = { input_tokens: 0, output_tokens: 0 }
  let submitted: Record<string, unknown> | null = null
  for (let turn = 0; turn < 3 && !submitted; turn++) {
    const msg = await claude()
      .messages.stream({ model: TERM_REVIEW_MODEL, max_tokens: 32000, thinking: { type: "adaptive" }, system: system(o.today), tools: [SUBMIT] as unknown as Anthropic.Messages.ToolUnion[], tool_choice: { type: "auto" }, messages })
      .finalMessage()
    usage.input_tokens += msg.usage.input_tokens
    usage.output_tokens += msg.usage.output_tokens
    const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT.name)
    if (call) submitted = call.input as Record<string, unknown>
    else messages.push({ role: "assistant", content: msg.content }, { role: "user", content: "Please call submit_term_review now." })
  }
  if (!submitted) throw new Error("Claude didn't submit a review.")

  // Keep only what we sent, and check every suggested negative against the terms we saw.
  const clip = (s: unknown, n: number) => withSymbols(String(s ?? "")).slice(0, n)
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const sentTerms = new Set(sent.map((t) => t.text))
  const kwTexts = new Set(keywords.map((k) => cleanTerm(k.dim1)))
  const seen: SeenTerm[] = all.map((t) => ({ text: t.text, spend: t.spend, results: t.results }))
  const terms: TermVerdict[] = arr(submitted.terms)
    .map((x) => ({ term: cleanTerm(String(x.term ?? "")), verdict: x.verdict === "exclude" ? ("exclude" as const) : ("watch" as const), reason: clip(x.reason, 140) }))
    .filter((x, i, a) => sentTerms.has(x.term) && a.findIndex((y) => y.term === x.term) === i)
  const roots: RootNegative[] = arr(submitted.roots)
    .map((x) => ({ text: cleanTerm(String(x.text ?? "")), matchType: (MATCH_TYPES.includes(x.match_type as MatchType) ? x.match_type : "PHRASE") as MatchType, reason: clip(x.reason, 140) }))
    .filter((x) => x.text && x.text.length <= 80 && x.text.split(" ").length <= 10)
    .slice(0, 10)
    .map((x) => ({ ...x, ...checkRoot(x, seen) }))
    .filter((x) => x.blocked > 0)
  const kws: KeywordVerdict[] = arr(submitted.keywords)
    .map((x) => ({ keyword: cleanTerm(String(x.keyword ?? "")), verdict: x.verdict === "pause" ? ("pause" as const) : ("review" as const), reason: clip(x.reason, 140) }))
    .filter((x) => kwTexts.has(x.keyword))

  const row = {
    client_id: o.clientId,
    platform: "google_ads",
    campaign_id: o.campaign.id,
    from_date: o.from,
    to_date: o.to,
    terms_sent: sent.length,
    headline: clip(submitted.headline, 400),
    points: arr(submitted.points).length ? (submitted.points as unknown[]).slice(0, 4).map((p) => clip(p, 240)) : [],
    terms,
    roots,
    keywords: kws,
    model: TERM_REVIEW_MODEL,
    usage,
    requested_by_profile_id: o.requestedBy,
  }
  const { data: saved, error } = await db.from("term_reviews").insert(row).select("id, created_at").single()
  if (error || !saved) throw new Error(`Saving the review: ${error?.message ?? "no row"}`)
  return { id: saved.id, createdAt: saved.created_at, from: o.from, to: o.to, termsSent: sent.length, headline: row.headline, points: row.points, terms, roots, keywords: kws }
}

/** The latest review for a campaign, read with the user's own client (RLS). */
export async function latestTermReview(supabase: SupabaseClient, clientId: string, campaignId: string): Promise<TermReview | null> {
  const { data } = await supabase
    .from("term_reviews")
    .select("id, created_at, from_date, to_date, terms_sent, headline, points, terms, roots, keywords")
    .eq("client_id", clientId)
    .eq("platform", "google_ads")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { id: data.id, createdAt: data.created_at, from: data.from_date, to: data.to_date, termsSent: data.terms_sent, headline: data.headline, points: data.points ?? [], terms: data.terms ?? [], roots: data.roots ?? [], keywords: data.keywords ?? [] }
}
