import type Anthropic from "@anthropic-ai/sdk"
import { getProfile } from "@/lib/auth"
import { aiConfigured, claude, SOURCE_GUIDE, WATCHED_PLATFORMS, WEB_SAFETY, webTools } from "@/lib/ai/claude"
import { NEWS_CACHE_DAYS, NEWS_STARTERS } from "@/lib/ai/news-starters"
import { londonToday } from "@/lib/checks/periods"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 120

/** The news chat is quick back-and-forth, so it uses Sonnet; sprint suggestions use Opus. */
const CHAT_MODEL = "claude-sonnet-5"

const system = (today: string) => `You are the paid media news desk inside "Sauvignon Blanc", Bordeaux & Burgundy's internal app. B&B is a B2B performance marketing agency. Today is ${today}.
You keep the team up to date on ${WATCHED_PLATFORMS}: new and upcoming campaign types, bidding, targeting, measurement and features, policy changes, and what B2B marketers are seeing. Always search the web before answering news questions; focus on the last 90 days unless asked otherwise. ${SOURCE_GUIDE}
Answer in short, scannable markdown (a line of summary, then bullets). Give dates. Say what it means for a B2B advertiser in one line when useful. Say plainly when something is a rumour, beta or limited rollout. Never invent news.
${WEB_SAFETY}`

type ChatMessage = { role: "user" | "assistant"; content: string }
type Answer = { answer: string; sources: { url: string; title: string }[]; at: string }

// Suggested questions being answered right now on this server, so a double click or a second
// person asking at the same moment waits for the same answer instead of paying twice.
const inflight = new Map<string, Promise<Answer | null>>()

/**
 * Streams newline-delimited JSON: {type:"status", text} while Claude searches, {type:"text", text}
 * for the answer, {type:"sources", sources} at the end, {type:"cached", at} when the answer was
 * reused, {type:"error", text} on failure. Suggested questions (NEWS_STARTERS) asked as the first
 * message are answered from a shared 7-day cache unless `fresh` is set. Anyone with a role can use
 * it. It reads the public web only; no client data is sent.
 */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!me.role) return new Response("No access", { status: 403 })
  if (!aiConfigured()) return new Response("Add ANTHROPIC_API_KEY to .env.local and restart.", { status: 503 })
  const body = (await request.json().catch(() => ({}))) as { messages?: ChatMessage[]; fresh?: boolean }
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }))
  if (!history.length || history.at(-1)!.role !== "user") return new Response("Ask something first.", { status: 400 })
  const limited = await rateLimit(await createClient(), "news_chat")
  if (limited) return new Response(limited, { status: 429 })

  const question = history.at(-1)!.content.trim()
  const cacheKey = history.length === 1 && NEWS_STARTERS.includes(question) ? question : null
  const db = createAdminClient()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"))
      const replay = (a: Answer) => {
        send({ type: "text", text: a.answer })
        send({ type: "sources", sources: a.sources })
        send({ type: "cached", at: a.at })
      }
      try {
        if (cacheKey && !body.fresh) {
          const since = new Date(Date.now() - NEWS_CACHE_DAYS * 864e5).toISOString()
          const { data: hit } = await db.from("news_answers").select("answer, sources, created_at").eq("question", cacheKey).gte("created_at", since).maybeSingle()
          if (hit) {
            replay({ answer: hit.answer, sources: hit.sources as Answer["sources"], at: hit.created_at })
            return controller.close()
          }
        }
        const pending = cacheKey ? inflight.get(cacheKey) : undefined
        if (pending) {
          send({ type: "status", text: "Someone just asked this. Waiting for the same answer…" })
          const a = await pending
          if (a) replay(a)
          else send({ type: "error", text: "The cellar door is stuck. Try again in a moment." })
          return controller.close()
        }

        let resolve: (a: Answer | null) => void = () => {}
        if (cacheKey) inflight.set(cacheKey, new Promise((r) => (resolve = r)))
        try {
          const a = await answer(history, send)
          send({ type: "sources", sources: a.sources })
          if (cacheKey && a.answer.trim()) {
            await db.from("news_answers").upsert({ question: cacheKey, answer: a.answer, sources: a.sources, model: CHAT_MODEL, usage: a.usage, created_at: a.at })
          }
          resolve(a)
        } catch (e) {
          resolve(null)
          throw e
        } finally {
          if (cacheKey) inflight.delete(cacheKey)
        }
      } catch (e) {
        console.error("[news-chat]", e)
        send({ type: "error", text: "The cellar door is stuck. Try again in a moment." })
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } })
}

/** One answer from Claude, streamed to `send` as it's written. */
async function answer(history: ChatMessage[], send: (o: unknown) => void): Promise<Answer & { usage: unknown }> {
  const sources = new Map<string, string>()
  const messages: Anthropic.MessageParam[] = [...history]
  let text = ""
  const usage = { input_tokens: 0, output_tokens: 0, web_searches: 0 }
  for (let turn = 0; turn < 3; turn++) {
    const s = claude().messages.stream({
      model: CHAT_MODEL,
      max_tokens: 4000,
      system: system(londonToday()),
      tools: webTools(5, 2) as unknown as Anthropic.Messages.ToolUnion[],
      messages,
    })
    s.on("text", (t) => {
      text += t
      send({ type: "text", text: t })
    })
    s.on("contentBlock", (b) => {
      if (b.type === "server_tool_use") {
        const input = b.input as { query?: string; url?: string }
        send({ type: "status", text: input.query ? `Searching: ${input.query}` : input.url ? `Reading ${new URL(input.url).hostname}` : "Researching" })
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
  return { answer: text, sources: [...sources].slice(0, 10).map(([url, title]) => ({ url, title })), at: new Date().toISOString(), usage }
}
