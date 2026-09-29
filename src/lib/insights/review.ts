import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { claude } from "@/lib/ai/claude"
import { londonToday } from "@/lib/checks/periods"
import { withSymbols } from "@/lib/format"
import { briefForPrompt } from "@/lib/knowledge/brief"
import { addDays } from "@/lib/metrics/ads"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { CLOSED_STATUSES, PAID_PRODUCTION_TYPES, PROP } from "@/lib/notion/config"
import { createAdminClient } from "@/lib/supabase/admin"
import { rpcAll } from "@/lib/supabase/rpc-all"
import { loadInsightInputs } from "./load"
import { computeInsights, isOpportunity, RULES } from "./rules"

/**
 * Performance phase 4: Claude's daily review of a client's "Optimise now" feed (see the
 * insight_reviews migration for what it writes). No web tools: it reads our numbers, the client brief
 * and the Notion briefs we already mirror. Nothing is written anywhere but insight_reviews.
 */
export const REVIEW_MODEL = "claude-opus-5-5"

export const CAMPAIGN_GOALS = ["leads", "trials", "demos", "pipeline", "retargeting", "awareness", "engagement", "event", "brand", "other"] as const
/** Goals not judged on cost per result (the rules skip the cost rules for these). */
export const AWARENESS_GOALS = ["awareness", "engagement"]

const SUBMIT = {
  name: "submit_review",
  description: "Submit the review of this client's Optimise now feed. Call it exactly once, at the end.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "Two sentences at most: what matters most in this account right now and why. Numbers with currency symbols." },
      start_here: {
        type: "array",
        maxItems: 3,
        description: "The 1-3 insights to act on first, most important first.",
        items: { type: "object", properties: { key: { type: "string", description: "The insight key exactly as given." }, why: { type: "string", description: "One line: why this first." } }, required: ["key", "why"] },
      },
      ranking: {
        type: "array",
        description: "Every open insight key, in the order the team should work through them, each with a short 'why now'.",
        items: { type: "object", properties: { key: { type: "string" }, why_now: { type: "string", description: "Under 20 words, specific to this client." } }, required: ["key", "why_now"] },
      },
      companies: {
        type: "array",
        description: "A verdict for every LinkedIn company listed, against the ICP in the client brief.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, fit: { type: "string", enum: ["icp", "not_icp", "unsure"] }, reason: { type: "string", description: "Under 15 words." } },
          required: ["name", "fit", "reason"],
        },
      },
      terms: {
        type: "array",
        description: "A verdict for every search term listed: is it relevant to what the client sells and who it sells to?",
        items: {
          type: "object",
          properties: { campaign_id: { type: "string" }, term: { type: "string" }, fit: { type: "string", enum: ["relevant", "clash", "unsure"] }, reason: { type: "string", description: "Under 15 words." } },
          required: ["campaign_id", "term", "fit", "reason"],
        },
      },
      goals: {
        type: "array",
        description: "The goal of every campaign listed.",
        items: {
          type: "object",
          properties: {
            platform: { type: "string", enum: ["linkedin", "google_ads", "meta"] },
            campaign_id: { type: "string" },
            goal: { type: "string", enum: [...CAMPAIGN_GOALS] },
            note: { type: "string", description: "Under 20 words: what the campaign is for and where you read it (name, Notion brief title, client brief)." },
          },
          required: ["platform", "campaign_id", "goal", "note"],
        },
      },
    },
    required: ["headline", "start_here", "ranking", "companies", "terms", "goals"],
  },
} as const

type Submitted = {
  headline: string
  start_here: { key: string; why: string }[]
  ranking: { key: string; why_now: string }[]
  companies: { name: string; fit: "icp" | "not_icp" | "unsure"; reason: string }[]
  terms: { campaign_id: string; term: string; fit: "relevant" | "clash" | "unsure"; reason: string }[]
  goals: { platform: Platform; campaign_id: string; goal: string; note: string }[]
}

const system = (today: string) => `You are the senior paid media strategist inside "Sauvignon Blanc", the internal app of Bordeaux & Burgundy (a B2B performance marketing agency). Today is ${today}.
Rules have already flagged issues and opportunities in this client's ad accounts. Your job:
1. Rank the open insights for the team: money at stake, how fixable, and how it fits the client's goals and targets in the brief. Opportunities matter as much as problems.
2. Judge each LinkedIn company that clicked against the ICP in the client brief (industry, size, type of organisation). Competitors, agencies, recruiters, students' universities, the client itself and obviously unrelated industries are not ICP. Use "unsure" when the brief doesn't settle it; don't guess.
3. Judge each costly search term: "clash" when it's plainly for something the client doesn't sell, a job search, a free/DIY intent the client can't serve, or a different audience from the ICP; "relevant" when it fits; "unsure" otherwise. Brand terms are relevant.
4. Work out each campaign's goal from its name, the Notion briefs listed and the client brief. The name often encodes it (e.g. "lg" lead gen, "rt"/"remarketing" retargeting, "free-trial", event names).
The team's must-knows win over everything else. Only use what's given; never invent numbers. Write in plain UK English, with currency symbols ($, £, €), never "USD". Call submit_review once, at the end.`

const money = (v: number, cur: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(v)

/** Everything Claude reads for the review, as text. Also returns the lists it must give verdicts on. */
async function reviewContext(clientId: string) {
  const db = createAdminClient()
  const input = await loadInsightInputs(db, clientId)
  if (!input) throw new Error("No ad data for this client yet.")
  const cur = input.currency
  const insights = computeInsights(input)
  const { data: log } = await db.from("insight_actions").select("insight_key, action, items, snooze_until, created_at").eq("client_id", clientId)
  const closedKeys = new Set((log ?? []).filter((a) => a.action === "dismissed" || (a.action === "snoozed" && a.snooze_until && a.snooze_until > londonToday())).map((a) => a.insight_key))
  const open = insights.filter((i) => !closedKeys.has(i.key))

  // LinkedIn companies that clicked (who interacted with the ads).
  const byCompany = new Map<string, { clicks: number; impressions: number; campaigns: Set<string> }>()
  for (const r of input.linkedin.li_company?.rows ?? []) {
    const e = byCompany.get(r.value) ?? { clicks: 0, impressions: 0, campaigns: new Set<string>() }
    e.clicks += r.m.clicks
    e.impressions += r.m.impressions
    e.campaigns.add(r.campaignName)
    byCompany.set(r.value, e)
  }
  const companies = [...byCompany].filter(([, e]) => e.clicks > 0).sort((a, b) => b[1].clicks - a[1].clicks).slice(0, 150)

  // Search terms that cost something and haven't converted (30 days).
  const to = input.dataThrough.google_ads
  const terms = to
    ? (await rpcAll(db, "search_term_candidates", { p_client: clientId, p_from: addDays(to, -29), p_to: to, p_min_spend: Math.max(25, 0.25 * (input.target ?? 200)), p_min_results: 1e9 }))
        .filter((t) => Number(t.results) === 0)
        .slice(0, 120)
    : []

  // Campaigns that ran in the last 30 days, and the client's paid media briefs in Notion (mirror, read only).
  const through = Object.values(input.dataThrough).sort().at(-1)!
  const campaigns = input.campaigns
    .map((c) => ({ c, spend: c.daily.filter((d) => d.date > addDays(through, -30)).reduce((s, d) => s + d.spend, 0), results: c.daily.filter((d) => d.date > addDays(through, -30)).reduce((s, d) => s + d.results, 0) }))
    .filter((x) => x.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 80)
  const { data: mirror } = await db.from("notion_pages_mirror").select("title, properties, last_edited_time").eq("client_id", clientId).eq("page_type", "brief").eq("in_trash", false).order("last_edited_time", { ascending: false }).limit(300)
  const text = (v: unknown) => (typeof v === "string" ? v : "")
  const briefs = (mirror ?? [])
    .map((m) => ({ title: m.title ?? "", type: text(m.properties?.[PROP.productionType]), status: text(m.properties?.[PROP.status]), paid: text(m.properties?.[PROP.statusPaid]), desc: text(m.properties?.[PROP.description]) }))
    .filter((b) => PAID_PRODUCTION_TYPES.includes(b.type) || !["", "N/A"].includes(b.paid))
    .slice(0, 60)

  const lines = [
    `# Client: ${input.clientName}`,
    `Target cost per result: ${input.target ? money(input.target, cur) : "not set"}. Data to ${through}.`,
    await briefForPrompt(clientId),
    `\n## Open insights (key | severity | kind | campaign | title | why | what to do | items)`,
    ...open.map((i) => `- ${i.key} | ${i.severity}${isOpportunity(i) ? " (opportunity)" : ""} | ${RULES[i.rule].label} | ${i.campaignName ?? "account"} | ${withSymbols(i.title)} | ${withSymbols(i.why)} | ${i.todo}${i.listed ? ` | ${i.items.length} items: ${i.items.slice(0, 8).map((x) => x.label).join("; ")}` : ""}`),
    `\n## LinkedIn companies that clicked in the last 30 days (company | clicks | impressions | campaigns)`,
    ...(companies.length ? companies.map(([n, e]) => `- ${n} | ${e.clicks} | ${e.impressions} | ${[...e.campaigns].slice(0, 4).join("; ")}`) : ["(none)"]),
    `\n## Google search terms with spend and no conversions in 30 days (campaign_id | campaign | term | spend | clicks)`,
    ...(terms.length ? terms.map((t) => `- ${t.campaign_id} | ${t.campaign_name} | ${t.term} | ${money(Number(t.spend), cur)} | ${t.clicks}`) : ["(none)"]),
    `\n## Campaigns with spend in the last 30 days (platform | campaign_id | name | status | spend | results)`,
    ...campaigns.map(({ c, spend, results }) => `- ${c.platform} | ${c.campaignId} | ${c.name} | ${c.status ?? "unknown"} | ${money(spend, cur)} | ${Math.round(results * 10) / 10}`),
    `\n## Paid media briefs in Notion, newest first (title | production type | status | description)`,
    ...(briefs.length ? briefs.map((b) => `- ${b.title} | ${b.type || "–"} | ${b.status || "–"}${CLOSED_STATUSES.includes(b.status) ? " (done)" : ""} | ${b.desc.replace(/\s+/g, " ").slice(0, 300)}`) : ["(none)"]),
    `\nPlatforms: ${Object.keys(input.dataThrough).map((p) => PLATFORM_LABEL[p as Platform]).join(", ")}.`,
  ]
  return { text: lines.join("\n"), openKeys: open.map((i) => i.key), companyNames: companies.map(([n]) => n), termKeys: terms.map((t) => `${t.campaign_id}|${String(t.term)}`), campaignKeys: campaigns.map(({ c }) => `${c.platform}|${c.campaignId}`) }
}

/** Runs one review (insight_reviews row `reviewId`, created by the caller). */
export async function runInsightReview(reviewId: string) {
  const db = createAdminClient()
  const { data: row } = await db.from("insight_reviews").select("id, client_id").eq("id", reviewId).single()
  if (!row) return
  const usage = { input_tokens: 0, output_tokens: 0 }
  try {
    const ctx = await reviewContext(row.client_id)
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${ctx.text}\n\nReview this feed, then call submit_review.` }]
    let submitted: Submitted | null = null
    for (let turn = 0; turn < 3 && !submitted; turn++) {
      const msg = await claude()
        .messages.stream({ model: REVIEW_MODEL, max_tokens: 24000, thinking: { type: "adaptive" }, system: system(londonToday()), tools: [SUBMIT] as unknown as Anthropic.Messages.ToolUnion[], messages })
        .finalMessage()
      usage.input_tokens += msg.usage.input_tokens
      usage.output_tokens += msg.usage.output_tokens
      const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT.name)
      if (call) submitted = call.input as Submitted
      else messages.push({ role: "assistant", content: msg.content }, { role: "user", content: "Please call submit_review now." })
    }
    if (!submitted) throw new Error("Claude didn't submit a review.")

    // Keep only verdicts on things we asked about, trimmed.
    const open = new Set(ctx.openKeys)
    const names = new Set(ctx.companyNames)
    const termKeys = new Set(ctx.termKeys)
    const campaignKeys = new Set(ctx.campaignKeys)
    const clip = (s: unknown, n: number) => withSymbols(String(s ?? "")).slice(0, n)
    await db
      .from("insight_reviews")
      .update({
        status: "ready",
        model: REVIEW_MODEL,
        headline: clip(submitted.headline, 400),
        start_here: (submitted.start_here ?? []).filter((x) => open.has(x.key)).slice(0, 3).map((x) => ({ key: x.key, why: clip(x.why, 200) })),
        ranking: (submitted.ranking ?? []).filter((x) => open.has(x.key)).map((x) => ({ key: x.key, why_now: clip(x.why_now, 160) })),
        companies: (submitted.companies ?? []).filter((x) => names.has(x.name) && ["icp", "not_icp", "unsure"].includes(x.fit)).map((x) => ({ name: x.name, fit: x.fit, reason: clip(x.reason, 140) })),
        terms: (submitted.terms ?? []).filter((x) => termKeys.has(`${x.campaign_id}|${x.term}`) && ["relevant", "clash", "unsure"].includes(x.fit)).map((x) => ({ campaign_id: x.campaign_id, term: x.term, fit: x.fit, reason: clip(x.reason, 140) })),
        goals: (submitted.goals ?? []).filter((x) => campaignKeys.has(`${x.platform}|${x.campaign_id}`) && (CAMPAIGN_GOALS as readonly string[]).includes(x.goal)).map((x) => ({ platform: x.platform, campaign_id: x.campaign_id, goal: x.goal, note: clip(x.note, 160) })),
        usage,
        finished_at: new Date().toISOString(),
      })
      .eq("id", reviewId)
  } catch (e) {
    console.error("insight review failed", e)
    await db.from("insight_reviews").update({ status: "failed", error: (e as Error).message.slice(0, 500), usage, finished_at: new Date().toISOString() }).eq("id", reviewId)
  }
}

/** Starts a review for a client (the caller has checked access). Returns its id. */
export async function startInsightReview(clientId: string, requestedBy: string | null) {
  const db = createAdminClient()
  const { data, error } = await db.from("insight_reviews").insert({ client_id: clientId, requested_by_profile_id: requestedBy }).select("id").single()
  if (error || !data) throw new Error(error?.message ?? "Couldn't start the review.")
  return data.id as string
}
