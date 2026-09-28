/**
 * Phase 0 helper: which conversion and lead fields actually have data? Read-only.
 *
 *   pnpm scan:conversions [days] [client name ...]   # default: 14 days, Camber and DNSFilter
 *
 * For each client's account on each connector it sums every numeric conversion/lead field over the
 * period and prints the ones that are non-zero. The rule (Dean, 2026-09-28): use the conversion
 * field that has data over the last 14 days.
 */
const apiKey = process.env.WINDSOR_API_KEY
if (!apiKey) {
  console.error("WINDSOR_API_KEY is missing. Add it to .env.local.")
  process.exit(1)
}
const args = process.argv.slice(2)
const days = Number(args[0]) || 14
const clients = (Number(args[0]) ? args.slice(1) : args).length ? (Number(args[0]) ? args.slice(1) : args) : ["Camber", "DNSFilter"]
const CONNECTORS = ["linkedin", "google_ads", "facebook"]
const CHUNK = 40 // fields per request

const isoDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10)
const asList = (b: any): any[] => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : [])
async function getJson(url: string) {
  const res = await fetch(url)
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function main() {
  const from = isoDate(days)
  const to = isoDate(1)
  console.log(`Conversion/lead fields with data, ${from} to ${to} (${days} days)`)
  for (const connector of CONNECTORS) {
    const accounts = asList((await getJson(`https://onboard.windsor.ai/api/common/ds-accounts?datasource=${connector}&api_key=${apiKey}`)).body)
    const fields = asList((await getJson(`https://connectors.windsor.ai/${connector}/fields?api_key=${apiKey}`)).body)
    const candidates = fields
      .filter((f) => f.type === "NUMERIC" && /conversion|lead/i.test(f.id) && !/value|cost|rate|micros|roas|retention|quantity|per_/i.test(f.id))
      .map((f) => ({ id: String(f.id), name: String(f.name) }))

    for (const client of clients) {
      const account = accounts.find((a) => String(a.account_name).toLowerCase().startsWith(client.toLowerCase()))
      console.log(`\n${connector} / ${client}: ${account ? `${account.account_name} (${account.account_id})` : "no account on this connector"}`)
      if (!account) continue
      const totals: Record<string, number> = {}
      let spend = 0
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const chunk = candidates.slice(i, i + CHUNK).map((c) => c.id)
        const url =
          `https://connectors.windsor.ai/${connector}?api_key=${apiKey}&date_from=${from}&date_to=${to}` +
          `&select_accounts=${encodeURIComponent(account.account_id)}&fields=account_id,spend,${chunk.join(",")}`
        const { status, body } = await getJson(url)
        if (status !== 200) {
          console.log(`  (a batch of ${chunk.length} fields failed: HTTP ${status} ${JSON.stringify(body).slice(0, 150)})`)
          continue
        }
        const rows = asList(body)
        if (i === 0) spend = rows.reduce((s, r) => s + (Number(r.spend) || 0), 0)
        for (const id of chunk) totals[id] = (totals[id] ?? 0) + rows.reduce((s, r) => s + (Number(r[id]) || 0), 0)
      }
      console.log(`  spend: ${spend.toFixed(2)}`)
      const hits = candidates.filter((c) => totals[c.id] > 0).sort((a, b) => totals[b.id] - totals[a.id])
      if (!hits.length) console.log(`  no conversion or lead field has data`)
      for (const c of hits) console.log(`  ${String(Math.round(totals[c.id] * 100) / 100).padStart(8)}  ${c.id}  "${c.name}"`)
    }
  }
}

main()
