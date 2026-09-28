import type Anthropic from "@anthropic-ai/sdk"
import { getProfile } from "@/lib/auth"
import { aiConfigured, claude, SOURCE_GUIDE, WATCHED_PLATFORMS, WEB_SAFETY, webTools } from "@/lib/ai/claude"
import { londonToday } from "@/lib/checks/periods"

export const maxDuration = 120

/** The news chat is quick back-and-forth, so it uses Sonnet; sprint suggestions use Opus. */
const CHAT_MODEL = "claude-sonnet-5"

const system = (today: string) => `You are the paid media news desk inside "Sauvignon Blanc", Bordeaux & Burgundy's internal app. B&B is a B2B performance marketing agency. Today is ${today}.
You keep the team up to date on ${WATCHED_PLATFORMS}: new and upcoming campaign types, bidding, targeting, measurement and features, policy changes, and what B2B marketers are seeing. Always search the web before answering news questions; focus on the last 90 days unless asked otherwise. ${SOURCE_GUIDE}
Answer in short, scannable markdown (a line of summary, then bullets). Give dates. Say what it means for a B2B advertiser in one line when useful. Say plainly when something is a rumour, beta or limited rollout. Never invent news.
${WEB_SAFETY}`

type ChatMessage = { role: "user" | "assistant"; content: string }

/**
 * Streams newline-delimited JSON: {type:"status", text} while Claude searches, {type:"text", text}
 * for the answer, {type:"sources", sources} at the end, {type:"error", text} on failure.
 * Anyone with a role can use it. It reads the public web only; no client data is sent.
 */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!me.role) return new Response("No access", { status: 403 })
  if (!aiConfigured()) return new Response("Add ANTHROPIC_API_KEY to .env.local and restart.", { status: 503 })
  const body = (await request.json().catch(() => ({}))) as { messages?: ChatMessage[] }
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }))
  if (!history.length || history.at(-1)!.role !== "user") return new Response("Ask something first.", { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"))
      const sources = new Map<string, string>()
      try {
        const messages: Anthropic.MessageParam[] = history
        for (let turn = 0; turn < 3; turn++) {
          const s = claude().messages.stream({
            model: CHAT_MODEL,
            max_tokens: 4000,
            system: system(londonToday()),
            tools: webTools(5, 2) as unknown as Anthropic.Messages.ToolUnion[],
            messages,
          })
          s.on("text", (t) => send({ type: "text", text: t }))
          s.on("contentBlock", (b) => {
            if (b.type === "server_tool_use") {
              const input = b.input as { query?: string; url?: string }
              send({ type: "status", text: input.query ? `Searching: ${input.query}` : input.url ? `Reading ${new URL(input.url).hostname}` : "Researching" })
            }
            if (b.type === "text") for (const c of b.citations ?? []) if ("url" in c && c.url) sources.set(c.url, ("title" in c && c.title) || c.url)
          })
          const msg = await s.finalMessage()
          if (msg.stop_reason !== "pause_turn") break
          messages.push({ role: "assistant", content: msg.content })
        }
        send({ type: "sources", sources: [...sources].slice(0, 10).map(([url, title]) => ({ url, title })) })
      } catch (e) {
        console.error("[news-chat]", e)
        send({ type: "error", text: "The cellar door is stuck. Try again in a moment." })
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } })
}
