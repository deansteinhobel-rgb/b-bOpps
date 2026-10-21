import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { claude, SOURCE_GUIDE, WEB_SAFETY, webTools } from "@/lib/ai/claude"
import { londonToday } from "@/lib/checks/periods"
import { createAdminClient } from "@/lib/supabase/admin"
import { fromJson, toJson, type Db } from "@/lib/supabase/db"
import { cleanPlaybook, type Playbook, type PlaybookSection, type PlaybookSource } from "./playbook"

export { playbookForPrompt, type Playbook } from "./playbook"

/**
 * The monthly best practice research behind the campaign builder (Dean, 2026-10-21: "taken monthly
 * from very reputable websites, reddit threads and linkedIn posts for each paid platform"). Claude
 * (Opus, web search and fetch) reads the platform's own docs and announcements, reputable trade
 * press and B2B research, practitioner threads on Reddit and practitioners' LinkedIn posts, and
 * writes the playbook as short points, each with its sources and how strong the evidence is.
 * Public information only: no client data goes in. One row per platform per run in ad_playbooks;
 * the builder reads the latest ready one. Cron /api/cron/playbook, or "Research now" in the builder.
 */
export const RESEARCH_MODEL = "claude-opus-5-5"
export const RESEARCH_PLATFORMS = ["linkedin", "google_ads", "meta", "reddit"] as const
export type ResearchPlatform = (typeof RESEARCH_PLATFORMS)[number]

const NAME: Record<ResearchPlatform, string> = { linkedin: "LinkedIn Ads", google_ads: "Google Ads", meta: "Meta Ads", reddit: "Reddit Ads" }

/** What each platform's research covers. LinkedIn first; the others follow the same outline. */
const TOPICS: Record<ResearchPlatform, string> = {
  linkedin: "campaign structure (groups, campaigns per audience and format), objectives and when each works for B2B, bidding (manual vs maximum delivery vs cost cap) and budgets, audience size and targeting (job titles vs functions and seniority, skills, company lists and contact lists for ABM/ABX, predictive audiences, audience expansion, the Audience Network), formats (single image, document, video, thought leader, conversation, text and Spotlight) and creative (intro text and headline length, hooks, visuals, refresh cadence and fatigue), lead gen forms vs website conversions and the Insight Tag / Conversions API, frequency, ABX measurement (account engagement, company engagement reports), and anything LinkedIn changed in the last 3 months",
  google_ads: "search campaign structure, match types and AI Max, Performance Max for B2B, bidding strategies and conversion value, negative keywords and brand exclusions, responsive search ads, Demand Gen, offline conversion imports, and anything Google changed in the last 3 months",
  meta: "B2B on Meta: Advantage+ audiences and placements, lead ads vs website conversions, the Conversions API, creative volume and fatigue, campaign structure and budgets, and anything Meta changed in the last 3 months",
  reddit: "Reddit Ads for B2B: community and interest targeting, conversation placements, bidding, lead gen, the Reddit Pixel and Conversions API, creative that fits Reddit, and anything Reddit changed in the last 3 months",
}

const SUBMIT: Anthropic.Tool = {
  name: "submit_playbook",
  description: "Submit the playbook. Call it exactly once, at the end.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Two or three sentences: what matters most this month and what changed." },
      sources: {
        type: "array",
        description: "Every source you used, numbered from 1.",
        items: { type: "object", properties: { n: { type: "integer" }, title: { type: "string" }, url: { type: "string" }, kind: { type: "string", enum: ["official", "research", "trade", "reddit", "linkedin", "other"] } }, required: ["n", "title", "url", "kind"] },
      },
      sections: {
        type: "array",
        minItems: 4,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            heading: { type: "string", description: "e.g. Structure, Bidding and budgets, Audiences, ABX, Creative, Formats, Measurement, What changed" },
            points: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "One practice, under 40 words, specific enough to act on (numbers where sources give them)." },
                  sources: { type: "array", items: { type: "integer" } },
                  strength: { type: "string", enum: ["official", "consensus", "practitioner"], description: "official = the platform says so; consensus = several reputable sources agree; practitioner = what people report on Reddit or LinkedIn, not proven." },
                },
                required: ["text", "sources", "strength"],
              },
            },
          },
          required: ["heading", "points"],
        },
      },
    },
    required: ["summary", "sources", "sections"],
  },
}

const system = (platform: ResearchPlatform, today: string) => `You are the head of paid media research at Bordeaux & Burgundy, a B2B performance marketing agency. Today is ${today}. Write this month's ${NAME[platform]} playbook: the practices the team and the campaign builder follow when setting up and editing campaigns for B2B clients. Write in US English.

Cover: ${TOPICS[platform]}.

How to research:
- Search widely: the platform's own help center, docs and announcements first, then B2B research and reputable trade press, then practitioners: Reddit (r/PPC, r/linkedinads, r/marketing, r/B2BMarketing) and LinkedIn posts by B2B paid media practitioners. Prefer the last 6 months; say when something is older.
- ${SOURCE_GUIDE}
- Practitioner tips are welcome but marked "practitioner"; never present them as the platform's rules.
- Where sources disagree, say so in the point.
- Be concrete (sizes, lengths, minimums, budgets) only where a source gives the number. Never invent numbers.
- ${WEB_SAFETY}`

export async function researchPlaybook(platform: ResearchPlatform, opts: { requestedBy?: string | null } = {}) {
  const db = createAdminClient(opts.requestedBy ?? undefined)
  const today = londonToday()
  const { data: run, error } = await db.from("ad_playbooks").insert({ platform, period: today.slice(0, 7), requested_by: opts.requestedBy ?? null }).select("id").single()
  if (error || !run) throw new Error(`Couldn't start the research: ${error?.message ?? "no row"}`)

  const usage = { input_tokens: 0, output_tokens: 0, web_searches: 0, web_fetches: 0 }
  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Research, then submit this month's ${NAME[platform]} playbook.` }]
    let submitted: Record<string, unknown> | null = null
    for (let turn = 0; turn < 6 && !submitted; turn++) {
      const msg = await claude()
        .messages.stream({ model: RESEARCH_MODEL, max_tokens: 24000, thinking: { type: "adaptive" }, system: system(platform, today), tools: [...webTools(14, 8), SUBMIT], messages })
        .finalMessage()
      usage.input_tokens += msg.usage.input_tokens
      usage.output_tokens += msg.usage.output_tokens
      usage.web_searches += msg.usage.server_tool_use?.web_search_requests ?? 0
      usage.web_fetches += (msg.usage.server_tool_use as { web_fetch_requests?: number } | null)?.web_fetch_requests ?? 0
      const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT.name)
      if (call) submitted = call.input as Record<string, unknown>
      else if (msg.stop_reason === "pause_turn") messages.push({ role: "assistant", content: msg.content })
      else messages.push({ role: "assistant", content: msg.content }, { role: "user", content: "Please call submit_playbook now." })
    }
    if (!submitted) throw new Error("Claude didn't submit a playbook.")
    const parsed = cleanPlaybook(submitted)
    await db.from("ad_playbooks").update({ status: "ready", summary: parsed.summary, sections: toJson(parsed.sections), sources: toJson(parsed.sources), model: RESEARCH_MODEL, usage: toJson(usage), completed_at: new Date().toISOString() }).eq("id", run.id)
    return run.id
  } catch (e) {
    await db.from("ad_playbooks").update({ status: "failed", error: (e as Error).message.slice(0, 500), usage: toJson(usage), completed_at: new Date().toISOString() }).eq("id", run.id)
    throw e
  }
}

export async function latestPlaybook(db: Db, platform: string): Promise<Playbook | null> {
  const { data } = await db.from("ad_playbooks").select("id, platform, period, summary, sections, sources, completed_at").eq("platform", platform).eq("status", "ready").order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  return { id: data.id, platform: data.platform, period: data.period, summary: data.summary ?? "", sections: fromJson<PlaybookSection[]>(data.sections, []), sources: fromJson<PlaybookSource[]>(data.sources, []), completedAt: data.completed_at }
}

