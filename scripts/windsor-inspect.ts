/**
 * Phase 0 throwaway script: discover what Windsor.ai gives us. Read-only.
 *
 *   pnpm inspect:windsor                      # all three connectors
 *   pnpm inspect:windsor linkedin facebook    # or just some
 *
 * For each connector it lists the accounts on the key and the fields the connector supports.
 * Then it pulls 7 days of spend, impressions, clicks and conversions for one account and prints
 * the raw response shape. Field IDs are picked from the connector's own field list, never hard-coded.
 * Full raw output is written to scripts/output/windsor-inspect.json (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs"

const CONNECTORS = ["linkedin", "google_ads", "facebook"] as const
const apiKey = process.env.WINDSOR_API_KEY
if (!apiKey) {
  console.error("WINDSOR_API_KEY is missing. Add it to .env.local (see .env.example).")
  process.exit(1)
}
const selected = process.argv.slice(2).length ? process.argv.slice(2) : [...CONNECTORS]

// Metrics and dimensions we want, as candidate field IDs in order of preference. Every candidate
// the connector offers is pulled in the smoke test, so you can compare them and pick. The first
// one found is the proposal. Names come from each connector's own field list.
const WANTED: Record<string, string[]> = {
  date: ["date"],
  account_id: ["account_id"],
  account_name: ["account_name"],
  currency: ["currency", "account_currency_code", "account_currency"],
  campaign_id: ["campaign_id", "campaign_group_id"],
  campaign_name: ["campaign", "campaign_name", "campaign_group_name"],
  ad_id: ["ad_id", "creative_id"],
  ad_name: ["ad_name", "sponsored_creative_content_title", "creative_name"],
  spend: ["spend", "cost", "totalcost"],
  impressions: ["impressions"],
  clicks: ["clicks", "link_clicks"],
  conversions: ["conversions", "externalwebsiteconversions", "all_conversions", "actions_offsite_conversion"],
  leads: ["leads", "oneclickleads", "actions_lead", "actions_onsite_conversion_lead_grouped", "actions_offsite_conversion_fb_pixel_lead"],
}
const MAX_LISTED = 60

const redact = (url: string) => url.replace(/api_key=[^&]+/, "api_key=REDACTED")

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url)
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: res.status, body }
}

function shape(v: any, depth = 0): any {
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `...${v.length} items`] : []
  if (v && typeof v === "object" && depth < 4) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]))
  return v === null ? "null" : typeof v
}

const asList = (body: any): any[] => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.fields) ? body.fields : [])

function isoDate(daysAgo: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

async function inspect(connector: string) {
  const out: any = { connector }
  console.log(`\n==================== ${connector} ====================`)

  // 1. Accounts on this key.
  const accUrl = `https://onboard.windsor.ai/api/common/ds-accounts?datasource=${connector}&api_key=${apiKey}`
  const acc = await getJson(accUrl)
  let accounts = asList(acc.body)
  console.log(`\nAccounts (GET ${redact(accUrl)}) -> HTTP ${acc.status}`)
  if (!accounts.length) {
    console.log(`  No list from the accounts endpoint. Raw: ${JSON.stringify(acc.body).slice(0, 300)}`)
    console.log(`  Falling back: deriving accounts from 30 days of data...`)
    const fb = await getJson(`https://connectors.windsor.ai/${connector}?api_key=${apiKey}&date_preset=last_30d&fields=account_id,account_name`)
    const seen = new Map<string, any>()
    for (const r of asList(fb.body)) seen.set(String(r.account_id), r)
    accounts = [...seen.values()]
  }
  for (const a of accounts) console.log(`  - ${a.account_name ?? "(no name)"}  id=${a.account_id}  ${a.status ?? ""}`)
  out.accounts_shape = shape(acc.body)
  out.accounts = accounts

  // 2. Fields the connector supports.
  const fieldsUrl = `https://connectors.windsor.ai/${connector}/fields?api_key=${apiKey}`
  const f = await getJson(fieldsUrl)
  const fields = asList(f.body)
  const fieldId = (x: any) => String(x.id ?? x.field_id ?? x.name ?? x)
  console.log(`\nFields (GET ${redact(fieldsUrl)}) -> HTTP ${f.status}, ${fields.length} fields. Shape of one: ${JSON.stringify(shape(fields[0]))}`)
  // Short list only: numeric fields that look like conversions or leads (the ones that differ most
  // between connectors). Everything else is in the JSON file.
  const byId = new Map(fields.map((x) => [fieldId(x), x]))
  const convLike = fields.filter((x) => x.type === "NUMERIC" && /conversion|lead/i.test(fieldId(x)) && !/value|cost_per|rate|micros|form/i.test(fieldId(x)))
  console.log(`Numeric conversion/lead fields (${convLike.length}${convLike.length > MAX_LISTED ? `, first ${MAX_LISTED}` : ""}):`)
  for (const x of convLike.slice(0, MAX_LISTED)) console.log(`  - ${fieldId(x)}  "${x.name}"`)
  out.fields = fields

  // 3. Pick field IDs from what the connector actually offers.
  const chosen: Record<string, string | null> = {}
  const present: Record<string, string[]> = {}
  for (const [want, candidates] of Object.entries(WANTED)) {
    present[want] = candidates.filter((c) => byId.has(c))
    chosen[want] = present[want][0] ?? null
  }
  console.log(`\nPROPOSED FIELD MAPPING (please confirm or correct):`)
  for (const [k, v] of Object.entries(chosen)) {
    const label = v ? `${v}  "${byId.get(v)?.name}"` : "?? no matching field"
    const alts = present[k].slice(1).map((a) => `${a} "${byId.get(a)?.name}"`)
    console.log(`  ${k.padEnd(14)} <- ${label}${alts.length ? `   (also available: ${alts.join(", ")})` : ""}`)
  }
  out.proposed_field_mapping = chosen
  out.candidate_fields = present

  // 4. Smoke test: 7 days for one account, filtered to that account by Windsor (not in code).
  const envKey = `WINDSOR_SAMPLE_ACCOUNT_${connector.toUpperCase()}`
  // Default to Camber (the definition-of-done client) when it's on this connector.
  const camber = accounts.find((a) => /camber/i.test(String(a.account_name)))
  const account = process.env[envKey] || (camber ?? accounts[0])?.account_id
  if (!account) {
    console.log(`\nNo account to smoke-test. Skipping.`)
    return out
  }
  const fieldList = [...new Set(Object.values(present).flat())].join(",")
  const dataUrl =
    `https://connectors.windsor.ai/${connector}?api_key=${apiKey}` +
    `&date_from=${isoDate(7)}&date_to=${isoDate(1)}` +
    `&select_accounts=${encodeURIComponent(String(account))}&fields=${fieldList}`
  const d = await getJson(dataUrl)
  const rows = asList(d.body)
  console.log(`\nSmoke test for account ${account} (GET ${redact(dataUrl)}) -> HTTP ${d.status}, ${rows.length} rows`)
  console.log(`Raw response shape: ${JSON.stringify(shape(d.body), null, 2)}`)
  console.log(`First 3 rows:`)
  for (const r of rows.slice(0, 3)) console.log(`  ${JSON.stringify(r)}`)
  if (!rows.length) console.log(`  (none) Raw body: ${JSON.stringify(d.body).slice(0, 500)}`)
  const accountIds = new Set(rows.map((r) => String(r[chosen.account_id ?? "account_id"])))
  if (accountIds.size > 1) console.log(`  WARNING: rows came back for ${accountIds.size} accounts. The account filter did not apply.`)
  const sum = (k: string) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100
  console.log(`7-day totals per candidate field (compare with the platform UI to pick the right one):`)
  for (const metric of ["spend", "impressions", "clicks", "conversions", "leads"]) {
    console.log(`  ${metric.padEnd(12)} ${present[metric].map((f) => `${f}=${sum(f)}`).join("   ") || "(no field)"}`)
  }
  const adIds = new Set(rows.map((r) => r[chosen.ad_id ?? ""]).filter(Boolean))
  console.log(`  distinct ads: ${adIds.size}, dates: ${[...new Set(rows.map((r) => r.date))].sort().join(", ")}`)
  out.smoke = { account, status: d.status, shape: shape(d.body), sample_rows: rows.slice(0, 20), row_count: rows.length }
  return out
}

async function main() {
  const report: any = { inspected_at: new Date().toISOString(), connectors: [] }
  for (const c of selected) {
    try {
      report.connectors.push(await inspect(c))
    } catch (e) {
      console.log(`\n${c}: failed. ${(e as Error).message}`)
      report.connectors.push({ connector: c, error: (e as Error).message })
    }
  }
  mkdirSync("scripts/output", { recursive: true })
  writeFileSync("scripts/output/windsor-inspect.json", JSON.stringify(report, null, 2))
  console.log(`\nFull output saved to scripts/output/windsor-inspect.json`)
  console.log(`NEXT: confirm or correct each PROPOSED FIELD MAPPING. Nothing is assumed until you do.`)
}

main()
