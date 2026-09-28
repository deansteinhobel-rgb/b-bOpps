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

// Metrics and dimensions we want. For each one, the patterns are tried in order against the
// connector's field IDs and the first match is used. Printed so you can confirm or correct.
const WANTED: Record<string, RegExp[]> = {
  date: [/^date$/],
  account_id: [/^account_id$/, /account.*id$/],
  account_name: [/^account_name$/, /account.*name$/],
  campaign_id: [/^campaign_id$/, /campaign.*id$/],
  campaign_name: [/^campaign$/, /^campaign_name$/, /campaign.*name$/],
  ad_id: [/^ad_id$/, /^creative_id$/, /(^|_)ad_id$/],
  ad_name: [/^ad_name$/, /^ad$/, /^creative_name$/, /(^|_)ad_name$/],
  spend: [/^spend$/, /^cost$/, /^totalcost$/, /cost_in_local/, /spend/],
  impressions: [/^impressions$/],
  clicks: [/^clicks$/, /^link_clicks$/],
  conversions: [/^conversions$/, /^externalwebsiteconversions$/, /^all_conversions$/, /conversion/],
  leads: [/^leads$/, /^one_click_leads$/, /^actions_lead$/, /lead/],
}
const INTERESTING = /spend|cost|impression|click|conversion|lead|ad_id|ad_name|creative|campaign|account|date|ctr|currency/i

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
  console.log(`Relevant fields:`)
  for (const x of fields.filter((x) => INTERESTING.test(fieldId(x)))) {
    console.log(`  - ${fieldId(x)}${x.name && x.name !== fieldId(x) ? `  "${x.name}"` : ""}${x.type ? `  [${x.type}]` : ""}`)
  }
  out.fields = fields

  // 3. Pick field IDs from what the connector actually offers.
  const ids = fields.map(fieldId)
  const chosen: Record<string, string | null> = {}
  for (const [want, patterns] of Object.entries(WANTED)) {
    chosen[want] = null
    for (const re of patterns) {
      const hit = ids.find((id) => re.test(id))
      if (hit) {
        chosen[want] = hit
        break
      }
    }
  }
  console.log(`\nPROPOSED FIELD MAPPING (please confirm or correct):`)
  for (const [k, v] of Object.entries(chosen)) console.log(`  ${k.padEnd(14)} <- ${v ?? "?? no matching field"}`)
  out.proposed_field_mapping = chosen

  // 4. Smoke test: 7 days for one account, filtered to that account by Windsor (not in code).
  const envKey = `WINDSOR_SAMPLE_ACCOUNT_${connector.toUpperCase()}`
  const account = process.env[envKey] || accounts[0]?.account_id
  if (!account) {
    console.log(`\nNo account to smoke-test. Skipping.`)
    return out
  }
  const fieldList = [...new Set(Object.values(chosen).filter(Boolean))].join(",")
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
  const sum = (k: string | null) => (k ? rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) : null)
  console.log(`Totals: spend=${sum(chosen.spend)} impressions=${sum(chosen.impressions)} clicks=${sum(chosen.clicks)} conversions=${sum(chosen.conversions)} leads=${sum(chosen.leads)}`)
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
