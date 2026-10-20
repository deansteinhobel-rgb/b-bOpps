import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { parseMetaTargeting } from "./settings-parse"
import { windsorRows } from "./rest"
import type { Json } from "@/lib/supabase/database.types"

/**
 * Platform settings checks (Dean, 2026-10-15): reads niche delivery settings from Windsor into
 * platform_settings (upserts only), for the urgent settings insights in Optimize now.
 * - Google: per campaign, location option (presence vs presence or interest), networks, AI Max.
 * - LinkedIn: Windsor has no audience expansion or Audience Network field, so the Audience Network is
 *   read from delivery: any spend served off LinkedIn (`serving_location`) in the last 3 days.
 * - Meta: per ad set, its targeting (Advantage+ audience, custom audiences, location types) and
 *   Audience Network spend in the last 3 days.
 * Only campaigns and ad sets that are running (Google, LinkedIn) or spent in the last 3 days (Meta).
 */

const DAYS = 3
const GOOGLE = [
  "campaign_id",
  "campaign",
  "campaign_status",
  "advertising_channel_type",
  "campaign_geo_target_type_setting_positive_geo_target_type",
  "campaign_network_settings_target_partner_search_network",
  "campaign_network_settings_target_content_network",
  "campaign_ai_max_setting_enable_ai_max",
]

type Row = Record<string, unknown>
type Account = { client_id: string; platform: "google_ads" | "linkedin" | "meta"; windsor_connector: string; external_account_id: string }
type SettingsRow = {
  client_id: string
  platform: Account["platform"]
  external_account_id: string
  level: "campaign" | "adset"
  entity_id: string
  entity_name: string | null
  campaign_id: string
  campaign_name: string | null
  settings: { [key: string]: Json | undefined }
  checked_at: string
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())
const bool = (v: unknown) => (v === null || v === undefined || v === "" ? null : /^(true|1)$/i.test(String(v)))
const num = (v: unknown) => Number(v) || 0

const windsor = (connector: string, account: string, fields: string[], from: string, to: string) =>
  windsorRows(connector, account, fields, from, to, { timeoutMs: 120_000 }) as Promise<Row[]>

async function googleRows(a: Account, from: string, to: string, at: string): Promise<SettingsRow[]> {
  const byId = new Map<string, Row>()
  for (const r of await windsor(a.windsor_connector, a.external_account_id, GOOGLE, from, to)) if (r.campaign_id) byId.set(str(r.campaign_id), r)
  return [...byId.values()]
    .filter((r) => str(r.campaign_status).toUpperCase() === "ENABLED")
    .map((r) => ({
      client_id: a.client_id,
      platform: a.platform,
      external_account_id: a.external_account_id,
      level: "campaign",
      entity_id: str(r.campaign_id),
      entity_name: str(r.campaign) || null,
      campaign_id: str(r.campaign_id),
      campaign_name: str(r.campaign) || null,
      settings: {
        geo_target_type: str(r.campaign_geo_target_type_setting_positive_geo_target_type).toUpperCase() || null,
        channel_type: str(r.advertising_channel_type).toUpperCase() || null,
        search_partners: bool(r.campaign_network_settings_target_partner_search_network),
        display_network: bool(r.campaign_network_settings_target_content_network),
        ai_max: bool(r.campaign_ai_max_setting_enable_ai_max),
      },
      checked_at: at,
    }))
}

async function linkedinRows(a: Account, from: string, to: string, at: string): Promise<SettingsRow[]> {
  const rows = await windsor(a.windsor_connector, a.external_account_id, ["campaign_id", "campaign", "campaign_status", "serving_location", "spend"], from, to)
  const byId = new Map<string, { name: string; status: string; offsite: number; spend: number }>()
  for (const r of rows) {
    const id = str(r.campaign_id)
    if (!id) continue
    const c = byId.get(id) ?? { name: str(r.campaign), status: str(r.campaign_status).toUpperCase(), offsite: 0, spend: 0 }
    c.spend += num(r.spend)
    if (str(r.serving_location) && str(r.serving_location).toUpperCase() !== "ON_SITE") c.offsite += num(r.spend)
    byId.set(id, c)
  }
  return [...byId.entries()]
    .filter(([, c]) => c.status === "ACTIVE" || c.offsite > 0)
    .map(([id, c]) => ({
      client_id: a.client_id,
      platform: a.platform,
      external_account_id: a.external_account_id,
      level: "campaign",
      entity_id: id,
      entity_name: c.name || null,
      campaign_id: id,
      campaign_name: c.name || null,
      settings: { audience_network_spend: c.offsite, spend: c.spend, days: DAYS },
      checked_at: at,
    }))
}

async function metaRows(a: Account, from: string, to: string, at: string): Promise<SettingsRow[]> {
  const [targeting, placements] = await Promise.all([
    windsor(a.windsor_connector, a.external_account_id, ["adset_id", "adset_name", "campaign_id", "campaign", "adset_targeting", "spend"], from, to),
    windsor(a.windsor_connector, a.external_account_id, ["adset_id", "publisher_platform", "spend"], from, to),
  ])
  const an = new Map<string, number>()
  for (const r of placements) if (str(r.publisher_platform).toLowerCase() === "audience_network") an.set(str(r.adset_id), (an.get(str(r.adset_id)) ?? 0) + num(r.spend))
  const byId = new Map<string, { r: Row; spend: number }>()
  for (const r of targeting) {
    const id = str(r.adset_id)
    if (!id) continue
    const s = byId.get(id) ?? { r, spend: 0 }
    s.spend += num(r.spend)
    if (r.adset_targeting) s.r = r
    byId.set(id, s)
  }
  return [...byId.entries()]
    .filter(([id, s]) => s.spend > 0 || (an.get(id) ?? 0) > 0)
    .map(([id, { r, spend }]) => ({
      client_id: a.client_id,
      platform: a.platform,
      external_account_id: a.external_account_id,
      level: "adset",
      entity_id: id,
      entity_name: str(r.adset_name) || null,
      campaign_id: str(r.campaign_id),
      campaign_name: str(r.campaign) || null,
      settings: { ...parseMetaTargeting(r.adset_targeting), audience_network_spend: an.get(id) ?? 0, spend, days: DAYS },
      checked_at: at,
    }))
}

export async function syncPlatformSettings(opts: { clientId?: string; to: string }) {
  const db = createAdminClient()
  let q = db.from("client_platform_accounts").select("client_id, platform, windsor_connector, external_account_id, clients!inner(active)").eq("active", true).eq("clients.active", true)
  if (opts.clientId) q = q.eq("client_id", opts.clientId)
  const { data: accounts, error } = await q
  if (error) throw new Error(error.message)
  const from = new Date(Date.parse(opts.to) - (DAYS - 1) * 864e5).toISOString().slice(0, 10)
  const results: { client_id: string; account: string; rows?: number; error?: string }[] = []
  for (const a of (accounts ?? []) as Account[]) {
    const at = new Date().toISOString()
    try {
      const rows =
        a.platform === "google_ads" ? await googleRows(a, from, opts.to, at)
        : a.platform === "linkedin" ? await linkedinRows(a, from, opts.to, at)
        : a.platform === "meta" ? await metaRows(a, from, opts.to, at)
        : []
      if (rows.length) {
        const { error: e } = await db.from("platform_settings").upsert(rows, { onConflict: "platform,external_account_id,level,entity_id" })
        if (e) throw new Error(e.message)
      }
      results.push({ client_id: a.client_id, account: `${a.windsor_connector} ${a.external_account_id}`, rows: rows.length })
    } catch (e) {
      results.push({ client_id: a.client_id, account: `${a.windsor_connector} ${a.external_account_id}`, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
