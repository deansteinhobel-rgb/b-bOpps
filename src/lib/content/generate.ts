import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { claude } from "@/lib/ai/claude"
import { londonToday } from "@/lib/checks/periods"
import { withSymbols } from "@/lib/format"
import { createAdminClient } from "@/lib/supabase/admin"
import { AD_CONTENT_TYPES } from "@/lib/taxonomy"
import { buildContentContext } from "./context"

/**
 * Content ideas (Dean, 2026-09-29): Claude works out what content is working, for whom, and suggests
 * content pieces, ads and angles to brief in or test. No web tools: it reads our numbers, the ad
 * creatives, the client brief and the Notion briefs we already mirror. Nothing is written anywhere
 * but content_idea_runs.
 */
export const CONTENT_MODEL = "claude-opus-5-5"

/** The same list the ad labels use (src/lib/taxonomy.ts), so content ideas and ads line up. */
export const CONTENT_TYPES = AD_CONTENT_TYPES
export const IDEA_KINDS = ["new_content", "repurpose", "new_angle", "new_audience", "new_format"] as const
export const IDEA_KIND_LABEL: Record<(typeof IDEA_KINDS)[number], string> = {
  new_content: "New content piece",
  repurpose: "Repurpose what works",
  new_angle: "New angle",
  new_audience: "New audience",
  new_format: "New format",
}

const SUBMIT = {
  name: "submit_content_ideas",
  description: "Submit what content is working and your content ideas. Call it exactly once, at the end.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "Two sentences, under 60 words, in plain words: which content is working, for whom, and the biggest opportunity. Numbers with currency symbols." },
      working: {
        type: "array",
        maxItems: 10,
        description: "The content that ran, grouped by offer (content piece) and audience, best first. Include what isn't working too, so the team can see both.",
        items: {
          type: "object",
          properties: {
            content_type: { type: "string", enum: [...CONTENT_TYPES] },
            topic: { type: "string", description: "The piece or its subject, e.g. 'Contract Management Problem Solver whitepaper'." },
            format: { type: "string", description: "e.g. Single image, Document ad, Video, Carousel, Search ad." },
            platform: { type: "string", enum: ["linkedin", "google_ads", "meta"] },
            audience: { type: "string", description: "Who it reached, from the targeting data and the campaign name, e.g. 'Procurement and commercial managers in UK public sector'." },
            campaigns: { type: "array", items: { type: "string" }, description: "Campaign names exactly as given." },
            spend: { type: "number" },
            results: { type: "number" },
            ctr: { type: "number", description: "Click-through rate as a fraction (0.0058 for 0.58%)." },
            verdict: { type: "string", enum: ["working", "mixed", "not_working", "too_early"] },
            why: { type: "string", description: "Under 30 words: why it works (or doesn't) for this audience. Say what you saw in the creative where it matters." },
          },
          required: ["content_type", "topic", "format", "platform", "audience", "campaigns", "spend", "results", "verdict", "why"],
        },
      },
      ideas: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        description: "Content ideas, ads or angles to brief in or test in a sprint, best first.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, specific: what to make and for whom. Under 12 words." },
            kind: { type: "string", enum: [...IDEA_KINDS] },
            content_type: { type: "string", enum: [...CONTENT_TYPES] },
            topic: { type: "string", description: "What the piece is about, in one line." },
            platform: { type: "string", enum: ["linkedin", "google_ads", "meta"] },
            format: { type: "string", description: "An ad format that exists on that platform, e.g. LinkedIn single image with a lead gen form, Thought Leader Ad, Conversation ad, Meta lead ad, Google responsive search ad." },
            audience: { type: "string", description: "Exactly who it's for: job titles or functions, seniority, sector." },
            audience_basis: { type: "string", enum: ["same", "new"], description: "'same' if it goes to an audience that already ran; 'new' if it's a new audience." },
            built_on: {
              type: "array",
              maxItems: 3,
              description: "What this idea builds on: campaigns or ads from the data, by exact name or [key].",
              items: { type: "object", properties: { ref: { type: "string" }, what: { type: "string", description: "Under 20 words: what it showed." } }, required: ["ref", "what"] },
            },
            evidence: { type: "string", description: "The numbers behind it, one or two lines." },
            why_it_fits: { type: "string", description: "Why this topic matters to this audience, and how it fits the ICP and the client's goals. If the audience is 'same', why this topic suits that audience; if 'new', why that audience would care." },
            hook: { type: "string", description: "The angle: a headline or opening line to brief the creative with." },
            success: { type: "string", description: "What success looks like, as a number where possible (e.g. 'CPL under £450 over 4 weeks')." },
            impact: { type: "integer", minimum: 1, maximum: 5 },
            confidence: { type: "integer", minimum: 1, maximum: 5 },
            effort: { type: "integer", minimum: 1, maximum: 5, description: "1 = reuse an existing piece, 5 = a new piece of content from scratch." },
          },
          required: ["title", "kind", "content_type", "topic", "platform", "format", "audience", "audience_basis", "built_on", "evidence", "why_it_fits", "hook", "success", "impact", "confidence", "effort"],
        },
      },
      avoid: {
        type: "array",
        maxItems: 4,
        description: "Content or pairings not to repeat, from the data (e.g. a format that failed twice, a topic that doesn't suit an audience).",
        items: { type: "object", properties: { what: { type: "string" }, why: { type: "string" } }, required: ["what", "why"] },
      },
    },
    required: ["headline", "working", "ideas", "avoid"],
  },
} as const

type Idea = { title: string; kind: string; content_type: string; topic: string; platform: string; format: string; audience: string; audience_basis: string; built_on: { ref: string; what: string }[]; evidence: string; why_it_fits: string; hook: string; success: string; impact: number; confidence: number; effort: number }
type Submitted = {
  headline: string
  working: { content_type: string; topic: string; format: string; platform: string; audience: string; campaigns: string[]; spend: number; results: number; ctr?: number; verdict: string; why: string }[]
  ideas: Idea[]
  avoid: { what: string; why: string }[]
}

const system = (today: string) => `You are the senior content and paid media strategist at Bordeaux & Burgundy, a content-first B2B marketing agency, working inside its internal app. Today is ${today}.
You're looking at one client's paid media: what content ran (the offer, its topic, the format, and the creative itself in the images), who it reached, and how it performed. Your job:
1. Work out what content is working and for whom. Read the campaign names (they often encode offer | audience | targeting | format | objective | asset), the ad names, the images and the audience data. Group by content piece and audience. Judge on cost per result against the target first, then results and CTR; small numbers are noisy, so say "too early" rather than over-reading 1–2 results.
2. Suggest 3–5 content ideas, ads or angles the team can brief in or test in a two-week sprint. We are a content-first agency, so favour content: a new piece, a repurposed winner (e.g. a whitepaper turned into a checklist or a case study into a webinar), a new angle on what works, or a proven piece for a new audience. Each idea must be buildable with ad formats that exist on that platform today.
THE AUDIENCE RULE (most important): the topic must fit the audience it goes to. A piece works because the right topic reached the right people. For example, DNSFilter's AI cybersecurity report worked because it went to dedicated cybersecurity job titles; suggesting a domain setup guide to that same audience would be wrong, because it's a different need for a different person. So:
- If an idea reuses an audience that already ran ("same"), the topic must be something that audience cares about in their role, ideally close to what already worked for them.
- If an idea takes a proven topic to a new audience ("new"), say why that audience would care, and check they're inside the ICP.
- Never pair a topic with an audience just because each did well separately.
3. List what to avoid repeating, from the evidence.
Use the client brief's ICP, targets and must-knows (the must-knows win over everything). Look at the tests already run and the Notion briefs already in production, so you don't suggest something that exists or was already tried and failed. Respect what the team said about earlier ideas: don't bring back a "not for us" idea unless the evidence has changed, and say so if you do.
Only use what's given; never invent numbers, pieces or audiences. Refer to campaigns and ads by their exact names or [key]. Plain UK English, currency symbols ($, £, €), never "USD" or "GBP". Call submit_content_ideas once, at the end.`

/** A list from Claude's tool input: sometimes an array arrives as a JSON string. */
function list<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[]
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}
const int = (v: unknown) => Math.min(5, Math.max(1, Math.round(Number(v) || 3)))

/** Runs one set of ideas (content_idea_runs row `runId`, created by the caller). */
export async function runContentIdeas(runId: string) {
  const db = createAdminClient()
  const { data: row } = await db.from("content_idea_runs").select("id, client_id").eq("id", runId).single()
  if (!row) return
  const usage = { input_tokens: 0, output_tokens: 0 }
  const progress = (p: string) => db.from("content_idea_runs").update({ progress: p }).eq("id", runId)
  try {
    await progress("Reading the campaigns, audiences and ads")
    const ctx = await buildContentContext(db, row.client_id)
    await progress("Looking at the creatives and working out what's landing")
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: [...ctx.blocks, { type: "text", text: "Work out what content is working and for whom, then call submit_content_ideas." }] }]
    let submitted: Submitted | null = null
    for (let turn = 0; turn < 3 && !submitted; turn++) {
      const msg = await claude()
        .messages.stream({ model: CONTENT_MODEL, max_tokens: 32000, thinking: { type: "adaptive" }, system: system(londonToday()), tools: [SUBMIT] as unknown as Anthropic.Messages.ToolUnion[], messages })
        .finalMessage()
      usage.input_tokens += msg.usage.input_tokens
      usage.output_tokens += msg.usage.output_tokens
      const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT.name)
      if (call) submitted = call.input as Submitted
      else messages.push({ role: "assistant", content: msg.content }, { role: "user", content: "Please call submit_content_ideas now." })
    }
    if (!submitted) throw new Error("Claude didn't submit any ideas.")

    const platforms = ["linkedin", "google_ads", "meta"]
    const names = new Set(ctx.campaignNames)
    // Claude refers to ads by [key] and sometimes prefixes campaign names with the platform: show names.
    const unprefix = (s: string) => s.replace(/^(LinkedIn|Google Ads|Meta)\s*\|\s*/i, "").trim()
    const deKey = (s: string) => s.replace(/\[((?:linkedin|google_ads|meta)\|[^\]]+)\]/g, (_, k: string) => (ctx.adNames[k] ? `"${ctx.adNames[k]}"` : "an ad"))
    const clip = (s: unknown, n: number) => {
      const t = deKey(withSymbols(String(s ?? "")))
      return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t
    }
    await db
      .from("content_idea_runs")
      .update({
        status: "ready",
        progress: null,
        model: CONTENT_MODEL,
        headline: clip(submitted.headline, 900),
        working: list<Submitted["working"][number]>(submitted.working)
          .filter((w) => platforms.includes(w.platform))
          .slice(0, 10)
          .map((w) => ({
            content_type: (CONTENT_TYPES as readonly string[]).includes(w.content_type) ? w.content_type : "Other",
            topic: clip(w.topic, 160),
            format: clip(w.format, 60),
            platform: w.platform,
            audience: clip(w.audience, 200),
            campaigns: list<string>(w.campaigns).map(unprefix).filter((c) => names.has(c)).slice(0, 6),
            spend: Number(w.spend) || 0,
            results: Number(w.results) || 0,
            ctr: w.ctr === undefined ? null : Number(w.ctr),
            verdict: ["working", "mixed", "not_working", "too_early"].includes(w.verdict) ? w.verdict : "mixed",
            why: clip(w.why, 300),
          })),
        ideas: list<Idea>(submitted.ideas)
          .filter((i) => platforms.includes(i.platform))
          .slice(0, 5)
          .map((i, n) => ({
            id: `${runId.slice(0, 8)}-${n + 1}`,
            title: clip(i.title, 120),
            kind: (IDEA_KINDS as readonly string[]).includes(i.kind) ? i.kind : "new_content",
            content_type: (CONTENT_TYPES as readonly string[]).includes(i.content_type) ? i.content_type : "Other",
            topic: clip(i.topic, 240),
            platform: i.platform,
            format: clip(i.format, 120),
            audience: clip(i.audience, 240),
            audience_basis: i.audience_basis === "new" ? "new" : "same",
            built_on: list<Idea["built_on"][number]>(i.built_on).slice(0, 3).map((b) => ({ ref: clip(unprefix(b.ref), 200), what: clip(b.what, 200) })),
            evidence: clip(i.evidence, 400),
            why_it_fits: clip(i.why_it_fits, 600),
            hook: clip(i.hook, 200),
            success: clip(i.success, 200),
            impact: int(i.impact),
            confidence: int(i.confidence),
            effort: int(i.effort),
          })),
        avoid: list<Submitted["avoid"][number]>(submitted.avoid).slice(0, 4).map((a) => ({ what: clip(a.what, 160), why: clip(a.why, 240) })),
        usage,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId)
  } catch (e) {
    console.error("content ideas failed", e)
    await db.from("content_idea_runs").update({ status: "failed", progress: null, error: (e as Error).message.slice(0, 500), usage, finished_at: new Date().toISOString() }).eq("id", runId)
  }
}

/** Starts a run for a client (the caller has checked access). Returns its id. */
export async function startContentIdeas(clientId: string, requestedBy: string | null) {
  const db = createAdminClient()
  const { data, error } = await db.from("content_idea_runs").insert({ client_id: clientId, requested_by_profile_id: requestedBy, progress: "Starting" }).select("id").single()
  if (error || !data) throw new Error(error?.message ?? "Couldn't start.")
  return data.id as string
}
