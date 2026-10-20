export type ChatMessage = { role: "user" | "assistant"; content: string }

/**
 * The conversation a chat route sends to Claude, from whatever the browser posted: the last 12 turns
 * that are real user / assistant messages, each up to 6,000 characters. Anything else is dropped.
 */
export function chatHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is ChatMessage => typeof m === "object" && m !== null && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }))
}
