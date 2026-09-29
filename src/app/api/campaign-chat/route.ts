import type Anthropic from "@anthropic-ai/sdk"
import { getProfile } from "@/lib/auth"
import { aiConfigured, claude, SOURCE_GUIDE, WEB_SAFETY, webTools } from "@/lib/ai/claude"
import { londonToday } from "@/lib/checks/periods"
import { buildCampaignContext } from "@/lib/insights/campaign-context"
import { WEEKLY_READ } from "@/lib/insights/campaign-starters"
import type { Platform } from "@/lib/metrics/types"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 120

/** Quick back-and-forth, so Sonnet (like the news chat). */
const CHAT_MODEL = "claude-sonnet-5"

const system = (today: string, context: string) => `You are the paid media analyst inside "Sauvignon Blanc", Bordeaux & Burgundy's internal app (a B2B performance marketing agency). Today is ${today}. You're answering questions about ONE campaign, using the data below.
How to answer:
- Lead with the answer in one or two lines, then short bullets with the numbers that back it. Compare weeks and the last 7 days against the 7 before; say what changed and why (clicks = impressions × CTR, results = clicks × conversion rate, cost per result = CPC ÷ conversion rate).
- Judge the campaign against its goal and the client brief: an awareness or engagement campaign isn't judged on cost per result. The team's must-knows win over everything.
- End with 1-3 concrete next steps the team can take in the platform. We can't change the platforms from here.
- Only use the numbers given; never invent any. Say when the data can't answer something. Currency symbols ($, £, €), never "USD". Plain UK English; dates like "22 Sept". The current week may be partial: say so rather than comparing it with full weeks.
- You may search the web for platform changes or benchmarks that explain what you see; cite them. ${SOURCE_GUIDE}
${WEB_SAFETY}

${context}`

type ChatMessage = { role: "user" | "assistant"; content: string }

/**
 * "Ask about this campaign": streams newline-delimited JSON like the news chat ({type:"status"|"text"|
 * "sources"|"cached"|"error"}). Anyone on the client's team. The weekly read (WEEKLY_READ as the first
 * message) is shared per campaign per week (campaign_reads) unless `fresh` is set.
 */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!me.role) return new Response("No access", { status: 403 })
  if (!aiConfigured()) return new Response("Add ANTHROPIC_API_KEY to .env.local and restart.", { status: 503 })
  const body = (await request.json().catch(() => ({}))) as { clientSlug?: string; platform?: string; campaignId?: string; messages?: ChatMessage[]; fresh?: boolean }
  const platform = (["linkedin", "google_ads", "meta"] as const).find((p) => p === body.platform)
  if (!platform || !body.campaignId) return new Response("Missing campaign.", { status: 400 })
  // Access: the client must load through the user's own RLS client.
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", body.clientSlug ?? "").maybeSingle()
  if (!client) return new Response("This client isn't available to you.", { status: 404 })
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }))
  if (!history.length || history.at(-1)!.role !== "user") return new Response("Ask something first.", { status: 400 })
  const limited = await rateLimit(supabase, "campaign_chat")
  if (limited) return new Response(limited, { status: 429 })
  const weekly = history.length === 1 && history[0].content.trim() === WEEKLY_READ
  const db = createAdminClient()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"))
      try {
        send({ type: "status", text: "Reading the campaign's numbers…" })
        const ctx = await buildCampaignContext(db, client.id, platform as Platform, body.campaignId!)
        if (!ctx) {
          send({ type: "error", text: "No data for this campaign yet." })
          return controller.close()
        }
        if (weekly && !body.fresh) {
          const { data: hit } = await db.from("campaign_reads").select("answer, sources, created_at").eq("client_id", client.id).eq("platform", platform).eq("campaign_id", body.campaignId).eq("week", ctx.week).maybeSingle()
          if (hit) {
            send({ type: "text", text: hit.answer })
            send({ type: "sources", sources: hit.sources })
            send({ type: "cached", at: hit.created_at })
            return controller.close()
          }
        }
        const a = await answer(system(londonToday(), ctx.text), history, send)
        send({ type: "sources", sources: a.sources })
        if (weekly && a.answer.trim()) {
          await db.from("campaign_reads").upsert({ client_id: client.id, platform, campaign_id: body.campaignId, week: ctx.week, answer: a.answer, sources: a.sources, model: CHAT_MODEL, usage: a.usage, created_at: new Date().toISOString() }, { onConflict: "client_id,platform,campaign_id,week" })
        }
      } catch (e) {
        console.error("[campaign-chat]", e)
        send({ type: "error", text: "Couldn't read the campaign right now. Try again in a moment." })
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } })
}

async function answer(systemPrompt: string, history: ChatMessage[], send: (o: unknown) => void) {
  const sources = new Map<string, string>()
  const messages: Anthropic.MessageParam[] = [...history]
  let text = ""
  const usage = { input_tokens: 0, output_tokens: 0, web_searches: 0 }
  for (let turn = 0; turn < 3; turn++) {
    const s = claude().messages.stream({ model: CHAT_MODEL, max_tokens: 10000, system: systemPrompt, tools: webTools(3, 1) as unknown as Anthropic.Messages.ToolUnion[], messages })
    s.on("text", (t) => {
      text += t
      send({ type: "text", text: t })
    })
    s.on("contentBlock", (b) => {
      if (b.type === "server_tool_use") {
        const input = b.input as { query?: string; url?: string }
        send({ type: "status", text: input.query ? `Searching: ${input.query}` : "Researching" })
      }
      if (b.type === "text") for (const c of b.citations ?? []) if ("url" in c && c.url) sources.set(c.url, ("title" in c && c.title) || c.url)
    })
    const msg = await s.finalMessage()
    usage.input_tokens += msg.usage.input_tokens
    usage.output_tokens += msg.usage.output_tokens
    usage.web_searches += msg.usage.server_tool_use?.web_search_requests ?? 0
    if (msg.stop_reason !== "pause_turn") break
    messages.push({ role: "assistant", content: msg.content })
  }
  return { answer: text, sources: [...sources].slice(0, 8).map(([url, title]) => ({ url, title })), usage }
}
