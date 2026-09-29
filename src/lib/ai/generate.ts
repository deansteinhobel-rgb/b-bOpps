import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/admin"
import { ASSETS, METRICS } from "@/lib/sprints/tests"
import { londonToday } from "@/lib/checks/periods"
import { claude, MODEL, SOURCE_GUIDE, WATCHED_PLATFORMS, WEB_SAFETY, webTools } from "./claude"
import { buildSprintContext } from "./context"

export const REC_PLATFORMS = ["linkedin", "google_ads", "meta", "reddit", "bing", "x", "chatgpt", "several"] as const

const SUBMIT: Anthropic.Tool = {
  name: "submit_sprint_plan",
  description: "Submit the suggested tests for this sprint, with a short market summary and the platform news behind them. Call this exactly once, at the end.",
  input_schema: {
    type: "object",
    required: ["market_summary", "news", "recommendations"],
    properties: {
      market_summary: { type: "string", description: "3-5 sentences: what's moving in B2B paid media right now that matters for this client." },
      news: {
        type: "array",
        description: "Recent or upcoming platform changes you found (campaign types, bidding, targeting, features). Only items with a source.",
        items: {
          type: "object",
          required: ["platform", "headline", "detail", "url"],
          properties: {
            platform: { type: "string" },
            headline: { type: "string" },
            detail: { type: "string", description: "One or two sentences, including when it lands if known." },
            date: { type: "string", description: "Publication or rollout date, YYYY-MM-DD if known." },
            url: { type: "string" },
          },
        },
      },
      recommendations: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          required: ["platform", "title", "summary", "impact", "expected_impact", "evidence", "hypothesis", "assets", "why_data", "confidence", "effort"],
          properties: {
            platform: { type: "string", enum: [...REC_PLATFORMS] },
            title: { type: "string", description: "What we're testing, in under 10 words. Starts with a verb." },
            summary: { type: "string", description: "The one-line reason to do this, under 20 words, e.g. 'Meta is at 41% of pace while retargeting costs $92 per result.'" },
            impact: { type: "string", enum: ["low", "medium", "high"], description: "Likely effect on the client's main KPI if it works." },
            expected_impact: { type: "string", description: "What we'd gain, under 10 words, e.g. '+40 results at ~$150 each' or 'Cut ~$3.4k of wasted spend'." },
            evidence: {
              type: "array",
              minItems: 2,
              maxItems: 3,
              description: "The 2-3 numbers that make the case, as short label/value pairs.",
              items: { type: "object", required: ["label", "value"], properties: { label: { type: "string", description: "Under 5 words, e.g. 'Meta pace'" }, value: { type: "string", description: "Under 12 characters, e.g. '41%', '$92', '7.5% → 3.6%'" } } },
            },
            hypothesis: { type: "string", description: "If we do X, then Y, because Z." },
            assets: { type: "array", items: { type: "string", enum: Object.keys(ASSETS) }, description: "What needs briefing in." },
            brief_notes: { type: "string", description: "What the team should brief: formats, angles, audiences, setup." },
            success_metric: { type: ["string", "null"], enum: [...Object.keys(METRICS), null] },
            success_target: { type: ["number", "null"], description: "Target for the metric (money in the client's currency; CTR as a percentage number, e.g. 0.8 for 0.8%)." },
            success_text: { type: "string", description: "What success looks like, in words." },
            why_data: { type: "string", description: "The specific numbers or past tests that point here. Quote them." },
            why_market: { type: "string", description: "The trend or platform news behind it, if any. Empty if none." },
            sources: { type: "array", items: { type: "object", required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } } },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            effort: { type: "string", enum: ["low", "medium", "high"] },
          },
        },
      },
    },
  },
}

type Submitted = {
  market_summary: string
  news: { platform: string; headline: string; detail: string; date?: string; url: string }[]
  recommendations: {
    platform: string
    title: string
    hypothesis: string
    assets: string[]
    brief_notes?: string
    success_metric?: string | null
    success_target?: number | null
    success_text?: string
    why_data: string
    why_market?: string
    sources?: { title: string; url: string }[]
    confidence: string
    effort: string
    summary?: string
    impact?: string
    expected_impact?: string
    evidence?: { label: string; value: string }[]
  }[]
}

const system = (today: string) => `You are the paid media strategist inside "Sauvignon Blanc", Bordeaux & Burgundy's internal app. B&B is a B2B performance marketing agency. Today is ${today}.

Your job: suggest 3 to 5 tests for a client's next two-week sprint. Good suggestions are:
- Grounded in this client's own numbers and past tests (quote the figures). Spot trends across weeks and sprints: what keeps working, what keeps failing, what's fatiguing.
- Doable in two weeks by a small team, with a measurable success target where possible (use the client's currency and KPI).
- Not repeats of what's already planned, and not re-runs of disproven tests unless there's a genuinely new angle (say what's new).
- Informed by what's happening in B2B paid media now, and by upcoming platform changes, where it fits. Don't force news in.
- Honest about confidence. Mix quick wins with at least one bolder idea.

If there's a client brief and must-knows from the team, use them: aim tests at the ICPs and messages it describes, work towards its targets, build on its learnings, and never break its rules. Cite it as [Client brief] in why_data.

Research first. Use web search to check (a) the latest B2B paid media trends and practitioner discussion, and (b) recent and upcoming changes on ${WATCHED_PLATFORMS}: new campaign types, bidding, targeting and features. Focus on the last 3 months. ${SOURCE_GUIDE}
The client runs LinkedIn, Google Ads and Meta through our data. Other platforms can be suggested if it makes sense, but say they aren't connected yet, so results would be tracked by hand.

${WEB_SAFETY} Never invent numbers, news or sources. If you're unsure, say so.
Write in plain UK English, short and specific. Always write money with the currency symbol ($, £, €), never "USD" or "GBP". Put the most important suggestion first. When you're done, call submit_sprint_plan once.`

type Update = { stage?: string; stage_note?: string | null; progress?: number }

/**
 * Runs one "Pour me a sprint" generation and stores the result. Reads our data, lets Claude
 * research the web, and writes only our own tables (the run row and draft suggestions). Access
 * must be checked before calling (GTM lead or admin, on this client).
 */
export async function generateSprintPlan(runId: string) {
  const db = createAdminClient()
  const set = async (u: Update & Record<string, unknown>) => {
    await db.from("sprint_ai_runs").update(u).eq("id", runId)
  }
  // Progress from stream events: fire and forget, but the query must be started (Supabase queries
  // only run when awaited or .then()'d).
  const nudge = (u: Update) => void set(u).catch(() => {})
  const { data: run } = await db.from("sprint_ai_runs").select("id, client_id, sprint_id").eq("id", runId).single()
  if (!run) return
  const usage = { input_tokens: 0, output_tokens: 0, web_searches: 0, web_fetches: 0 }
  try {
    await set({ stage: "reading", stage_note: "Reading 12 weeks of Windsor data and every past test", progress: 0.08 })
    const context = await buildSprintContext(db, run.client_id, run.sprint_id)
    await set({ progress: 0.2 })

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${context}\n\nResearch, then suggest the tests for this sprint.` }]
    let progress = 0.2
    let submitted: Submitted | null = null
    for (let turn = 0; turn < 6 && !submitted; turn++) {
      const stream = claude().messages.stream({
        model: MODEL,
        max_tokens: 20000,
        thinking: { type: "adaptive" },
        system: system(londonToday()),
        tools: [...webTools(8, 4), SUBMIT] as Anthropic.Messages.ToolUnion[],
        messages,
      })
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use") {
          const input = block.input as { query?: string; url?: string }
          progress = Math.min(progress + 0.06, 0.72)
          nudge({ stage: "researching", stage_note: input.query ? `Searching: ${input.query}` : input.url ? `Reading: ${input.url}` : "Researching", progress })
        }
      })
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") nudge({ stage: "drafting", stage_note: "Writing up your tests", progress: Math.max(progress, 0.82) })
      })
      const msg = await stream.finalMessage()
      usage.input_tokens += msg.usage.input_tokens
      usage.output_tokens += msg.usage.output_tokens
      usage.web_searches += msg.usage.server_tool_use?.web_search_requests ?? 0
      usage.web_fetches += (msg.usage.server_tool_use as { web_fetch_requests?: number } | null)?.web_fetch_requests ?? 0

      const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT.name)
      if (call) submitted = call.input as Submitted
      else if (msg.stop_reason === "pause_turn") messages.push({ role: "assistant", content: msg.content })
      else {
        messages.push({ role: "assistant", content: msg.content }, { role: "user", content: "Please call submit_sprint_plan now with your suggestions." })
      }
    }
    if (!submitted?.recommendations?.length) throw new Error("Claude didn't return any suggestions.")

    const recs = submitted.recommendations.slice(0, 5).map((r, i) => ({
      run_id: run.id,
      client_id: run.client_id,
      sprint_id: run.sprint_id,
      position: i,
      platform: (REC_PLATFORMS as readonly string[]).includes(r.platform) ? r.platform : "several",
      title: String(r.title).slice(0, 200),
      hypothesis: r.hypothesis?.slice(0, 1000) ?? null,
      assets: (r.assets ?? []).filter((a) => a in ASSETS),
      brief_notes: r.brief_notes?.slice(0, 3000) || null,
      success_metric: r.success_metric && r.success_metric in METRICS ? r.success_metric : null,
      success_target: typeof r.success_target === "number" && Number.isFinite(r.success_target) ? r.success_target : null,
      success_text: r.success_text?.slice(0, 500) || null,
      why_data: r.why_data?.slice(0, 2000) ?? null,
      why_market: r.why_market?.slice(0, 2000) || null,
      sources: (r.sources ?? []).filter((s) => /^https?:\/\//.test(s.url)).slice(0, 8),
      confidence: ["low", "medium", "high"].includes(r.confidence) ? r.confidence : null,
      effort: ["low", "medium", "high"].includes(r.effort) ? r.effort : null,
      summary: r.summary?.slice(0, 300) || null,
      impact: r.impact && ["low", "medium", "high"].includes(r.impact) ? r.impact : null,
      expected_impact: r.expected_impact?.slice(0, 120) || null,
      evidence: (r.evidence ?? []).filter((e) => e?.label && e?.value).slice(0, 3).map((e) => ({ label: String(e.label).slice(0, 40), value: String(e.value).slice(0, 24) })),
    }))
    const { error } = await db.from("sprint_recommendations").insert(recs)
    if (error) throw new Error(error.message)
    await set({
      status: "ready",
      stage: "done",
      stage_note: null,
      progress: 1,
      market_summary: submitted.market_summary?.slice(0, 3000) ?? null,
      news: (submitted.news ?? []).filter((n) => /^https?:\/\//.test(n.url)).slice(0, 15),
      model: MODEL,
      usage,
      finished_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error("[sprint-ai] run failed", runId, e)
    await set({ status: "failed", stage: "done", error: (e as Error).message.slice(0, 500), usage, finished_at: new Date().toISOString() })
  }
}
