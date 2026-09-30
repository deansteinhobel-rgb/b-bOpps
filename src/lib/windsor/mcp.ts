import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { windsorLiveClients, type PushDb, type PushDeps, type PushParams } from "./negatives"

/**
 * Windsor's write actions only exist on its MCP server (https://mcp.windsor.ai/, bearer = our
 * Windsor API key), not on the REST API we read from. This is a minimal MCP client over streamable
 * HTTP that can run ONE action: google_ads `push_negative_keywords`. There is deliberately no
 * general "execute any action" function (CLAUDE.md: the app adds negatives and nothing else).
 */
const MCP_URL = "https://mcp.windsor.ai/"
const ALLOWED = { connector: "google_ads", action: "push_negative_keywords" } as const

type Rpc = { result?: unknown; error?: { message?: string } }

async function session(key: string) {
  let sid: string | null = null
  let id = 1
  const send = async (method: string, params?: object): Promise<Rpc | null> => {
    const notify = method.startsWith("notifications/")
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}), ...(notify ? {} : { id: id++ }) }),
      signal: AbortSignal.timeout(60_000),
    })
    sid ??= res.headers.get("mcp-session-id")
    if (!res.ok && !notify) throw new Error(`Windsor MCP ${method}: HTTP ${res.status}`)
    const text = await res.text()
    if (!text.trim()) return null
    // Streamable HTTP answers either as JSON or as a server-sent event with the JSON in its data line.
    const data = text.match(/^data: (.*)$/m)?.[1] ?? text
    return JSON.parse(data) as Rpc
  }
  const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lumaux", version: "1" } })
  if (init?.error) throw new Error(`Windsor MCP initialize: ${init.error.message ?? "failed"}`)
  await send("notifications/initialized")
  return send
}

export function windsorMcp(key: string): NonNullable<PushDeps["windsor"]> {
  return {
    async pushNegativeKeywords(accountId: string, params: PushParams) {
      const send = await session(key)
      const r = await send("tools/call", { name: "execute_action", arguments: { ...ALLOWED, account: accountId, params } })
      if (r?.error) throw new Error(`Windsor: ${r.error.message ?? "the push failed"}`)
      const result = r?.result as { isError?: boolean } | undefined
      return { isError: Boolean(result?.isError), result: result ?? null }
    },
  }
}

/** Both switches must be flipped by Dean before anything reaches Google Ads. */
export function windsorWritesLive(clientSlug?: string) {
  const on = process.env.WINDSOR_WRITES_ENABLED === "true" && process.env.WINDSOR_DRY_RUN === "false"
  const only = windsorLiveClients()
  return on && (!clientSlug || !only || only.includes(clientSlug.toLowerCase()))
}

/** Production dependencies for pushNegativeKeywords. The Windsor writer only exists when writes are live. */
export function pushDeps(): PushDeps {
  const key = process.env.WINDSOR_API_KEY
  return {
    db: createAdminClient() as unknown as PushDb,
    windsor: windsorWritesLive() && key ? windsorMcp(key) : null,
    env: {
      writesEnabled: process.env.WINDSOR_WRITES_ENABLED === "true",
      dryRun: process.env.WINDSOR_DRY_RUN !== "false",
      liveClients: windsorLiveClients(),
    },
  }
}
