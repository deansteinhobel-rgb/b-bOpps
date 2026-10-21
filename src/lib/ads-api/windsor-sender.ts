import { PlatformRefused, type BuildOperation, type Sender } from "./build"

/**
 * Google Ads and Meta builds through Windsor's write actions (Dean, 2026-10-21; CLAUDE.md: never
 * the Google Ads or Meta APIs directly). Each build step maps to one Windsor action from a fixed
 * list, and write-guard.ts (inside `run`) checks it again and forces every create to paused.
 *
 * Meta images: the step carries `image_path` (our copy in campaign-assets); the sender swaps it for
 * a one-hour signed link Meta fetches the image from, and never passes the path on.
 *
 * UNVERIFIED (2026-10-21): no build has gone through Windsor yet, so the shape of the reply (where
 * the new object's id sits) is read defensively by `createdId`. Check the first live build's log.
 * A plain module: the server passes in `run` (mcp.ts runAction) and `signedUrl`.
 */

export type WindsorRun = (connector: "google_ads" | "facebook", action: string, accountId: string, params: Record<string, unknown>) => Promise<{ isError: boolean; result: unknown }>
export type WindsorSenderDeps = { run: WindsorRun; signedUrl: (path: string) => Promise<string> }

const ACTIONS: Record<"google_ads" | "meta", Partial<Record<BuildOperation, string>>> = {
  google_ads: {
    create_campaign: "create_campaign",
    set_locations: "set_campaign_geo_targeting",
    set_languages: "set_campaign_language_targeting",
    create_ad_group: "create_ad_group",
    add_keywords: "push_keywords",
    create_ad: "create_responsive_search_ad",
    create_asset: "create_ad_asset",
  },
  meta: { create_campaign: "create_campaign", create_ad_set: "create_adset", create_ad: "create_ad" },
}

/** Steps that change settings on something the build already created: there's no new id to keep. */
const NO_NEW_OBJECT = new Set<BuildOperation>(["set_locations", "set_languages", "add_keywords"])

/** Campaign assets live at <client uuid>/<file>; anything else isn't ours to hand out. */
export const CAMPAIGN_IMAGE = /^[0-9a-f-]{36}\/[\w.-]+\.(png|jpe?g|gif)$/i

/** Windsor's reply as text and as structured data (MCP content blocks and structuredContent). */
function replyOf(result: unknown): { text: string; data: unknown[] } {
  const r = (result ?? {}) as { content?: { type?: string; text?: string }[]; structuredContent?: unknown }
  const text = (r.content ?? []).filter((c) => c.type === "text" && c.text).map((c) => c.text!).join("\n")
  const data: unknown[] = []
  if (r.structuredContent !== undefined) data.push(r.structuredContent)
  for (const c of r.content ?? []) {
    if (c.type !== "text" || !c.text) continue
    try {
      data.push(JSON.parse(c.text))
    } catch {
      // Plain text: read below.
    }
  }
  return { text, data }
}

const ID_KEYS = ["id", "campaign_id", "ad_group_id", "adset_id", "ad_id", "asset_id", "creative_id", "resource_name"]
const TRAILING_ID = /(\d{5,})\s*$/

/** The id of what a create made: the first id-like value in the reply. Null when there isn't one. */
export function createdId(result: unknown, operation?: BuildOperation): string | null {
  const { text, data } = replyOf(result)
  // The most specific key first: an ad reply may also carry its ad group's id.
  const preferred = operation === "create_campaign" ? "campaign_id" : operation === "create_ad_group" ? "ad_group_id" : operation === "create_ad_set" ? "adset_id" : operation === "create_ad" ? "ad_id" : operation === "create_asset" ? "asset_id" : "id"
  const keys = [preferred, ...ID_KEYS.filter((k) => k !== preferred)]
  const fromValue = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) return String(v)
    if (typeof v === "string") return /^\d+$/.test(v) ? v : (v.match(TRAILING_ID)?.[1] ?? null)
    return null
  }
  const walk = (v: unknown, depth: number): string | null => {
    if (depth > 4 || !v || typeof v !== "object") return null
    if (Array.isArray(v)) {
      for (const x of v) {
        const id = walk(x, depth + 1)
        if (id) return id
      }
      return null
    }
    const o = v as Record<string, unknown>
    for (const k of keys) {
      const id = k in o ? fromValue(o[k]) : null
      if (id) return id
    }
    for (const inner of Object.values(o)) {
      const id = walk(inner, depth + 1)
      if (id) return id
    }
    return null
  }
  for (const d of data) {
    const id = walk(d, 0)
    if (id) return id
  }
  // Plain text replies: "Created campaign 123456 …" or a resource name.
  return text.match(/(?:id|ID)[^\d]{0,12}(\d{5,})/)?.[1] ?? text.match(/\/(\d{5,})(?:\b|$)/)?.[1] ?? null
}

/** Swaps `image_path` for a short-lived link Meta can fetch: in the creative when there is one, else image_url. */
export async function withImageLink(payload: Record<string, unknown>, signedUrl: (path: string) => Promise<string>) {
  const { image_path, ...rest } = payload
  if (image_path === undefined) return rest
  const path = String(image_path)
  if (!CAMPAIGN_IMAGE.test(path)) throw new PlatformRefused("That isn't a campaign image.")
  // Nothing has been sent yet, so a failure here is a clear refusal.
  const url = await signedUrl(path).catch(() => {
    throw new PlatformRefused("Couldn't make a link to the image for Meta.")
  })
  const creative = rest.creative as { object_story_spec?: { link_data?: Record<string, unknown> } } | undefined
  if (creative?.object_story_spec?.link_data) {
    return { ...rest, creative: { ...creative, object_story_spec: { ...creative.object_story_spec, link_data: { ...creative.object_story_spec.link_data, picture: url } } } }
  }
  return { ...rest, image_url: url }
}

export function windsorSender(platform: "google_ads" | "meta", deps: WindsorSenderDeps): Sender {
  const connector = platform === "meta" ? "facebook" : "google_ads"
  return {
    async send(operation, accountId, payload) {
      const action = ACTIONS[platform][operation]
      if (!action) throw new PlatformRefused(`${platform === "meta" ? "Meta" : "Google Ads"} has no ${operation} here.`)
      if (!/^[\d-]+$/.test(accountId)) throw new PlatformRefused("That isn't an ad account.")
      const params = platform === "meta" ? await withImageLink(payload, deps.signedUrl) : payload
      const r = await deps.run(connector, action, accountId, params)
      const { text } = replyOf(r.result)
      // Windsor answers a refused write as an error result: nothing was created.
      if (r.isError) throw new PlatformRefused(`Windsor ${action}: ${text.slice(0, 400) || "the platform refused it"}`, r.result)
      if (NO_NEW_OBJECT.has(operation)) return { id: "done", raw: r.result }
      const id = createdId(r.result, operation)
      if (!id) throw new Error(`Windsor ${action}: done, but no id came back`)
      return { id, raw: r.result }
    },
  }
}
