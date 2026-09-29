import "server-only"
import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Platform change history into platform_changes (see the migration). Reads Windsor; writes only our
 * database (upserts, never deletes). Google and Meta give their own logs; LinkedIn doesn't, so edited
 * ads are detected from each creative's last-modified time.
 */

type Account = { client_id: string; platform: "google_ads" | "meta" | "linkedin"; connector: string; external_account_id: string }
type Row = {
  client_id: string
  platform: Account["platform"]
  external_account_id: string
  changed_at: string
  actor: string | null
  via: string | null
  object_type: string
  operation: string
  campaign_id: string | null
  campaign_name: string | null
  object_name: string | null
  summary: string
  detail: string | null
  change_count: number
  campaigns: string[]
  bulk: boolean
  change_key: string
}

const BULK = 10 // this many of the same change in the same hour counts as one bulk change
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 20)
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

async function windsor(connector: string, account: string, fields: string[], from: string, to: string) {
  const params = new URLSearchParams({ api_key: process.env.WINDSOR_API_KEY ?? "", date_from: from, date_to: to, select_accounts: account, fields: fields.join(",") })
  const res = await fetch(`https://connectors.windsor.ai/${connector}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(250_000) })
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown>[] } | null
  if (!res.ok || !Array.isArray(body?.data)) throw new Error(`Windsor ${connector}: HTTP ${res.status}`)
  return body.data
}

async function campaignNames(clientId: string) {
  const db = createAdminClient()
  const { data } = await db.from("campaign_statuses").select("platform, campaign_id, campaign_name").eq("client_id", clientId)
  const names = new Map((data ?? []).map((r) => [`${r.platform}|${r.campaign_id}`, r.campaign_name as string]))
  // Campaigns that stopped more than two weeks ago aren't in the status list: fall back to the metrics.
  const { data: more } = await db.rpc("client_campaigns", { p_client: clientId, p_from: "2026-01-01" })
  for (const r of (more ?? []) as { platform: string; campaign_id: string; campaign_name: string }[]) {
    const k = `${r.platform}|${r.campaign_id}`
    if (!names.has(k)) names.set(k, r.campaign_name)
  }
  return names
}

// ---- Google Ads ----------------------------------------------------------------------------------

const GOOGLE_VIA: Record<string, string> = {
  GOOGLE_ADS_WEB_CLIENT: "Google Ads (web)",
  GOOGLE_ADS_MOBILE_APP: "Google Ads app",
  GOOGLE_ADS_EDITOR: "Google Ads Editor",
  GOOGLE_ADS_AUTOMATED_RULE: "Automated rule",
  GOOGLE_ADS_SCRIPTS: "Google Ads script",
  GOOGLE_ADS_BULK_UPLOAD: "Bulk upload",
  GOOGLE_ADS_API: "API or tool",
  GOOGLE_ADS_RECOMMENDATIONS: "Google recommendation",
  SEARCH_ADS_360_SYNC: "Search Ads 360",
  SEARCH_ADS_360_POST: "Search Ads 360",
  INTERNAL_TOOL: "Google (internal)",
  OTHER: "Other",
  UNKNOWN: "API or tool",
}
const GOOGLE_TYPE: Record<string, string> = {
  CAMPAIGN: "Campaign",
  CAMPAIGN_BUDGET: "Budget",
  AD_GROUP: "Ad group",
  AD_GROUP_AD: "Ad",
  AD: "Ad",
  AD_GROUP_CRITERION: "Keyword or audience",
  CAMPAIGN_CRITERION: "Campaign targeting",
  AD_GROUP_BID_MODIFIER: "Bid adjustment",
  ASSET: "Asset",
  AD_GROUP_ASSET: "Asset",
  CAMPAIGN_ASSET: "Asset",
  CUSTOMER_ASSET: "Asset",
  ASSET_SET: "Asset set",
  CAMPAIGN_ASSET_SET: "Asset set",
  ASSET_GROUP: "Asset group",
  ASSET_GROUP_ASSET: "Asset",
  FEED: "Feed",
  FEED_ITEM: "Feed item",
}
const OPERATION: Record<string, string> = { CREATE: "added", UPDATE: "changed", REMOVE: "removed" }
const VERB: Record<string, string> = { added: "Added", changed: "Changed", removed: "Removed", other: "Changed" }

/** What a criterion is, from the fields that changed (Google lumps targeting of every kind together). */
function criterionKind(fields: string, type: string) {
  if (/ipBlock/.test(fields)) return ["IP exclusion", "IP exclusions"]
  if (/keyword/.test(fields)) return /negative/.test(fields) ? ["negative keyword", "negative keywords"] : ["keyword", "keywords"]
  if (/location|proximity/.test(fields)) return ["location", "locations"]
  if (/userList|audience|userInterest|customAffinity|combinedAudience/.test(fields)) return ["audience", "audiences"]
  if (/placement|youtubeChannel|youtubeVideo|mobileApp/.test(fields)) return ["placement", "placements"]
  if (/adSchedule/.test(fields)) return ["ad schedule", "ad schedules"]
  if (/device/.test(fields)) return ["device setting", "device settings"]
  if (/language/.test(fields)) return ["language", "languages"]
  if (/ageRange|gender|parentalStatus|incomeRange/.test(fields)) return ["demographic", "demographics"]
  if (/webpage|listingScope|productGroup|listingGroup/.test(fields)) return ["product or page target", "product or page targets"]
  return type === "AD_GROUP_CRITERION" ? ["ad group target", "ad group targets"] : ["campaign target", "campaign targets"]
}

/** The fields that changed, in words (for updates). */
function changedWords(fields: string) {
  const f = fields.split(",").map((x) => x.trim())
  const words = new Set<string>()
  for (const x of f) {
    if (/^(resourceName|campaign|adGroup|criterionId|id)$/.test(x)) continue
    if (/status/i.test(x)) words.add("status")
    else if (/amountMicros|budget/i.test(x)) words.add("budget")
    else if (/bidding|targetCpa|targetRoas|maximize|manualCpc|cpcBidMicros|cpmBid|bid/i.test(x)) words.add("bidding")
    else if (/finalUrl|trackingUrl|urlCustom/i.test(x)) words.add("URLs")
    else if (/headline|description|responsiveSearchAd|ad\.text|imageAd|video/i.test(x)) words.add("ad text or creative")
    else if (/name$/i.test(x)) words.add("name")
    else if (/startDate|endDate|schedule/i.test(x)) words.add("dates")
    else if (/network|targetingSetting|geoTarget/i.test(x)) words.add("targeting settings")
    else if (/conversion/i.test(x)) words.add("conversion settings")
    else words.add(x.split(".").at(-1)!.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase())
  }
  return [...words].slice(0, 5)
}

export async function syncGoogleChanges(a: Account, from: string, to: string) {
  const rows = await windsor("google_ads", a.external_account_id, [
    "change_event_change_date_time",
    "change_event_user_email",
    "change_event_client_type",
    "change_event_change_resource_type",
    "change_event_resource_change_operation",
    "change_event_changed_fields",
    "change_event_campaign",
    "change_event_change_resource_name",
  ], from, to)
  const names = await campaignNames(a.client_id)
  // Old or removed campaigns aren't in our data: ask Windsor for every campaign name this year.
  const missing = new Set(rows.map((r) => str(r.change_event_campaign).split("/").at(-1) ?? "").filter((id) => id && !names.has(`google_ads|${id}`)))
  if (missing.size) {
    const list = await windsor("google_ads", a.external_account_id, ["campaign_id", "campaign"], `${to.slice(0, 4)}-01-01`, to).catch(() => [])
    for (const r of list) if (str(r.campaign_id) && str(r.campaign)) names.set(`google_ads|${str(r.campaign_id)}`, str(r.campaign))
  }
  // Group: same person, tool, kind of change and operation in the same hour.
  type G = { at: string; actor: string; via: string; type: string; op: string; fields: string; kind: [string, string]; campaigns: Set<string>; resources: Set<string>; words: Set<string> }
  const groups = new Map<string, G>()
  for (const r of rows) {
    const at = str(r.change_event_change_date_time)
    if (!at) continue
    const type = str(r.change_event_change_resource_type)
    const op = OPERATION[str(r.change_event_resource_change_operation)] ?? "other"
    const fields = str(r.change_event_changed_fields)
    const kind = type.includes("CRITERION") ? (criterionKind(fields, type) as [string, string]) : ([GOOGLE_TYPE[type] ?? type.toLowerCase().replace(/_/g, " "), `${GOOGLE_TYPE[type] ?? type.toLowerCase().replace(/_/g, " ")}s`] as [string, string])
    const hour = at.slice(0, 13)
    const actor = str(r.change_event_user_email) || "Google"
    const via = GOOGLE_VIA[str(r.change_event_client_type)] ?? "API or tool"
    const key = [hour, actor, via, type, op, kind[0], op === "changed" ? changedWords(fields).join("+") : ""].join("|")
    const g = groups.get(key) ?? { at, actor, via, type, op, fields, kind, campaigns: new Set<string>(), resources: new Set<string>(), words: new Set<string>() }
    if (at < g.at) g.at = at
    const campaignId = str(r.change_event_campaign).split("/").at(-1) ?? ""
    if (campaignId) g.campaigns.add(campaignId)
    g.resources.add(str(r.change_event_change_resource_name) || `${at}|${campaignId}`)
    if (op === "changed") changedWords(fields).forEach((w) => g.words.add(w))
    groups.set(key, g)
  }
  const out: Row[] = []
  for (const [key, g] of groups) {
    const n = g.resources.size
    const campaignList = [...g.campaigns].map((id) => names.get(`google_ads|${id}`) ?? id)
    const one = g.campaigns.size === 1 ? [...g.campaigns][0] : null
    const what = n === 1 ? g.kind[0] : plural(n, g.kind[0], g.kind[1])
    const where = g.campaigns.size > 1 ? ` in ${plural(g.campaigns.size, "campaign")}` : ""
    const summary =
      g.op === "changed" && ["Campaign", "Budget", "Ad group", "Ad"].includes(g.kind[0])
        ? `${VERB[g.op]} ${[...g.words].join(", ") || "settings"} on ${n === 1 ? `a ${g.kind[0].toLowerCase()}` : plural(n, g.kind[0].toLowerCase())}${where}`
        : `${VERB[g.op]} ${what}${where}`
    out.push({
      client_id: a.client_id,
      platform: "google_ads",
      external_account_id: a.external_account_id,
      changed_at: new Date(`${g.at.replace(" ", "T").slice(0, 23)}Z`).toISOString(),
      actor: g.actor,
      via: g.via,
      object_type: g.kind[0].charAt(0).toUpperCase() + g.kind[0].slice(1),
      operation: g.op,
      campaign_id: one,
      campaign_name: one ? (names.get(`google_ads|${one}`) ?? null) : null,
      object_name: null,
      summary: summary.charAt(0).toUpperCase() + summary.slice(1),
      detail: g.op === "changed" && g.words.size ? `Changed: ${[...g.words].join(", ")}` : null,
      change_count: n,
      campaigns: campaignList.slice(0, 50),
      bulk: n >= BULK,
      change_key: hash(key),
    })
  }
  return out
}

// ---- Meta ------------------------------------------------------------------------------------------

/** Meta dates come as "9/26/2026 at 9:19 PM" in the ad account's time zone; kept as written (to the minute). */
function metaDate(s: string) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) at (\d{1,2}):(\d{2}) (AM|PM)$/)
  if (!m) return null
  let h = Number(m[4]) % 12
  if (m[6] === "PM") h += 12
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]))).toISOString()
}
const META_SKIP = /billing|payment|invoice|funding|spend_limit_reached|ad_account_billing/i

export async function syncMetaChanges(a: Account, from: string, to: string) {
  const rows = await windsor("facebook", a.external_account_id, [
    "activity_date_time_in_timezone",
    "activity_actor_name",
    "activity_event_type",
    "activity_translated_event_type",
    "activity_object_name",
    "activity_object_type",
    "activity_extra_data",
  ], from, to)
  const out: Row[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const type = str(r.activity_event_type)
    if (!type || META_SKIP.test(type)) continue
    const at = metaDate(str(r.activity_date_time_in_timezone))
    if (!at) continue
    const key = [at, type, str(r.activity_object_name), str(r.activity_actor_name)].join("|")
    if (seen.has(key)) continue
    seen.add(key)
    let detail: string | null = null
    try {
      const x = JSON.parse(str(r.activity_extra_data) || "{}") as { old_value?: unknown; new_value?: unknown; type?: string }
      if (x.old_value !== undefined || x.new_value !== undefined) detail = `${x.type ? `${String(x.type).replace(/_/g, " ")}: ` : ""}${x.old_value ?? "–"} → ${x.new_value ?? "–"}`.slice(0, 300)
    } catch {}
    const objectType = str(r.activity_object_type).toLowerCase()
    out.push({
      client_id: a.client_id,
      platform: "meta",
      external_account_id: a.external_account_id,
      changed_at: at,
      actor: str(r.activity_actor_name) || null,
      via: "Meta Ads Manager",
      object_type: objectType === "campaign" ? "Campaign" : objectType === "adset" || objectType === "ad_set" ? "Ad set" : objectType === "ad" ? "Ad" : objectType ? objectType.charAt(0).toUpperCase() + objectType.slice(1) : "Account",
      operation: /create/i.test(type) ? "added" : /delete|remove|archive/i.test(type) ? "removed" : "changed",
      campaign_id: null,
      campaign_name: objectType === "campaign" ? str(r.activity_object_name) || null : null,
      object_name: str(r.activity_object_name) || null,
      summary: str(r.activity_translated_event_type) || type.replace(/_/g, " "),
      detail,
      change_count: 1,
      campaigns: [],
      bulk: false,
      change_key: hash(key),
    })
  }
  return out
}

// ---- LinkedIn (detected) ---------------------------------------------------------------------------

export async function syncLinkedInChanges(a: Account, from: string, to: string) {
  const rows = await windsor("linkedin", a.external_account_id, ["campaign_id", "campaign", "creative_id", "sponsored_creative_content_title", "creative_last_modified_datetime"], from, to)
  const db = createAdminClient()
  const { data: known } = await db.from("creative_modified_state").select("creative_id, last_modified").eq("external_account_id", a.external_account_id)
  const before = new Map((known ?? []).map((k) => [k.creative_id as string, k.last_modified as string | null]))
  const firstRun = before.size === 0
  const latest = new Map<string, { campaignId: string; campaign: string; title: string; modified: string }>()
  for (const r of rows) {
    const id = str(r.creative_id)
    const modified = str(r.creative_last_modified_datetime)
    if (!id || !modified) continue
    const prev = latest.get(id)
    if (!prev || modified > prev.modified) latest.set(id, { campaignId: str(r.campaign_id), campaign: str(r.campaign), title: str(r.sponsored_creative_content_title), modified })
  }
  const out: Row[] = []
  for (const [id, c] of latest) {
    const iso = new Date(`${c.modified}Z`).toISOString()
    const prev = before.get(id)
    // An ad we already knew whose last-modified time moved on: it was edited. (Not on the first run,
    // when every ad is new to us.)
    if (!firstRun && prev !== undefined && prev !== null && iso > new Date(prev).toISOString()) {
      out.push({
        client_id: a.client_id,
        platform: "linkedin",
        external_account_id: a.external_account_id,
        changed_at: iso,
        actor: null,
        via: "Detected",
        object_type: "Ad",
        operation: "changed",
        campaign_id: c.campaignId || null,
        campaign_name: c.campaign || null,
        object_name: c.title || null,
        summary: "Edited an ad",
        detail: "LinkedIn doesn't say who or what changed; the ad's last-modified time moved on.",
        change_count: 1,
        campaigns: c.campaign ? [c.campaign] : [],
        bulk: false,
        change_key: hash(`edit|${id}|${iso}`),
      })
    }
  }
  const state = [...latest].map(([id, c]) => ({ client_id: a.client_id, external_account_id: a.external_account_id, creative_id: id, campaign_id: c.campaignId || null, last_modified: new Date(`${c.modified}Z`).toISOString(), checked_at: new Date().toISOString() }))
  for (let i = 0; i < state.length; i += 500) await db.from("creative_modified_state").upsert(state.slice(i, i + 500), { onConflict: "external_account_id,creative_id" })
  return out
}

/** A campaign's status moved on since the last check (from the daily status sync; LinkedIn only, because Google and Meta log it themselves). */
export async function recordStatusChange(x: { client_id: string; platform: "linkedin"; external_account_id: string; campaign_id: string; campaign_name: string | null; from: string; to: string }) {
  const words: Record<string, string> = { ACTIVE: "active", PAUSED: "paused", ARCHIVED: "archived", COMPLETED: "completed", CANCELED: "cancelled", DRAFT: "draft" }
  const at = new Date().toISOString()
  await createAdminClient()
    .from("platform_changes")
    .upsert(
      {
        client_id: x.client_id,
        platform: x.platform,
        external_account_id: x.external_account_id,
        changed_at: at,
        actor: null,
        via: "Detected",
        object_type: "Campaign",
        operation: "changed",
        campaign_id: x.campaign_id,
        campaign_name: x.campaign_name,
        object_name: null,
        summary: `Campaign ${words[x.to] ?? x.to.toLowerCase()}`,
        detail: `Status: ${words[x.from] ?? x.from.toLowerCase()} → ${words[x.to] ?? x.to.toLowerCase()} (seen on the daily check; LinkedIn doesn't say who)`,
        change_count: 1,
        campaigns: x.campaign_name ? [x.campaign_name] : [],
        bulk: false,
        change_key: hash(`status|${x.campaign_id}|${x.from}|${x.to}|${at.slice(0, 10)}`),
      },
      { onConflict: "client_id,platform,change_key" },
    )
}

/** Every active account's change history over [from, to]. */
export async function syncPlatformChanges(opts: { from: string; to: string; clientId?: string; platforms?: Account["platform"][] }) {
  const db = createAdminClient()
  let q = db.from("client_platform_accounts").select("client_id, platform, windsor_connector, external_account_id, clients!inner(active)").eq("active", true).eq("clients.active", true)
  if (opts.clientId) q = q.eq("client_id", opts.clientId)
  const { data: accounts } = await q
  const results: { account: string; rows?: number; error?: string; seconds: number }[] = []
  await Promise.all(
    (accounts ?? [])
      .filter((a) => !opts.platforms || opts.platforms.includes(a.platform as Account["platform"]))
      .map(async (raw) => {
        const a: Account = { client_id: raw.client_id, platform: raw.platform as Account["platform"], connector: raw.windsor_connector, external_account_id: raw.external_account_id }
        const t = Date.now()
        try {
          const rows = a.platform === "google_ads" ? await syncGoogleChanges(a, opts.from, opts.to) : a.platform === "meta" ? await syncMetaChanges(a, opts.from, opts.to) : await syncLinkedInChanges(a, opts.from, opts.to)
          for (let i = 0; i < rows.length; i += 500) {
            const { error } = await db.from("platform_changes").upsert(rows.slice(i, i + 500), { onConflict: "client_id,platform,change_key" })
            if (error) throw new Error(error.message)
          }
          results.push({ account: `${a.platform} ${a.external_account_id}`, rows: rows.length, seconds: Math.round((Date.now() - t) / 1000) })
        } catch (e) {
          results.push({ account: `${a.platform} ${a.external_account_id}`, error: (e as Error).message, seconds: Math.round((Date.now() - t) / 1000) })
        }
      }),
  )
  return results
}
