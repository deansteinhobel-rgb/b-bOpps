import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { AdWriteDeps, CreateAdParams, PauseAdParams } from "./google-ads"
import { windsorLiveClients, type PushDb, type PushDeps, type PushParams } from "./negatives"
import { guardParams, type WindsorAction, type WindsorConnector } from "./write-guard"

/**
 * Windsor's write actions only exist on its MCP server (https://mcp.windsor.ai/, bearer = our
 * Windsor API key), not on the REST API we read from. This is a minimal MCP client over streamable
 * HTTP that can run a FIXED list of actions per connector (write-guard.ts): Google Ads negatives, ads
 * and pauses, plus campaign builds and edits for Google Ads, Meta and Microsoft Ads (Dean,
 * 2026-10-21). Every create goes in paused. There is deliberately no general "execute any action"
 * function: Windsor also offers enable, remove and delete actions, and the app must never reach
 * them (CLAUDE.md, "Ad platform writes").
 */
const MCP_URL = "https://mcp.windsor.ai/"

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

async function run(key: string, action: WindsorAction<"google_ads">, accountId: string, params: object) {
  return runAction(key, "google_ads", action, accountId, params as Record<string, unknown>)
}

/** One allowed action on one connector (write-guard.ts checks it and forces creates to paused). */
export async function runAction(key: string, connector: WindsorConnector, action: string, accountId: string, params: Record<string, unknown>) {
  const checked = guardParams(connector, action, params)
  const send = await session(key)
  const r = await send("tools/call", { name: "execute_action", arguments: { connector, action, account: accountId, params: checked } })
  if (r?.error) throw new Error(`Windsor: ${r.error.message ?? "the write failed"}`)
  const result = r?.result as { isError?: boolean } | undefined
  return { isError: Boolean(result?.isError), result: result ?? null }
}

export function windsorMcp(key: string): NonNullable<PushDeps["windsor"]> {
  return { pushNegativeKeywords: (accountId: string, params: PushParams) => run(key, "push_negative_keywords", accountId, params) }
}

/** Creates ads paused, whatever the caller passes, and pauses ads. Nothing else. */
export function windsorAdWriter(key: string): NonNullable<AdWriteDeps["windsor"]> {
  return {
    createSearchAd: (accountId: string, params: CreateAdParams) => run(key, "create_responsive_search_ad", accountId, { ...params, status: "paused" }),
    pauseAd: (accountId: string, params: PauseAdParams) => run(key, "pause_ad", accountId, { ad_group_id: params.ad_group_id, ad_id: params.ad_id }),
  }
}

/** Both switches must be flipped by Dean before anything reaches Google Ads. */
export function windsorWritesLive(clientSlug?: string) {
  const on = process.env.WINDSOR_WRITES_ENABLED === "true" && process.env.WINDSOR_DRY_RUN === "false"
  const only = windsorLiveClients()
  return on && (!clientSlug || !only || only.includes(clientSlug.toLowerCase()))
}

/** Ad writes need their own third switch, WINDSOR_AD_WRITES_ENABLED=true (Dean alone flips it). */
export function windsorAdWritesLive(clientSlug?: string) {
  return windsorWritesLive(clientSlug) && process.env.WINDSOR_AD_WRITES_ENABLED === "true"
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

/** Production dependencies for createSearchAd / pauseAds. */
export function adWriteDeps(): AdWriteDeps {
  const key = process.env.WINDSOR_API_KEY
  return {
    db: createAdminClient() as unknown as PushDb,
    windsor: windsorAdWritesLive() && key ? windsorAdWriter(key) : null,
    env: {
      writesEnabled: process.env.WINDSOR_WRITES_ENABLED === "true",
      dryRun: process.env.WINDSOR_DRY_RUN !== "false",
      adWritesEnabled: process.env.WINDSOR_AD_WRITES_ENABLED === "true",
      liveClients: windsorLiveClients(),
    },
  }
}
