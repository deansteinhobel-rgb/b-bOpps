/**
 * Loads seed/clients.json and seed/checks.md into Supabase. Safe to re-run: it only inserts or
 * updates (upsert) and never deletes anything. It never touches Notion.
 *
 *   pnpm seed            # apply
 *   pnpm seed --dry-run  # show what would be written, change nothing
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
import { parseChecks } from "./seed-checks"

const dryRun = process.argv.includes("--dry-run")
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.")
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

type Person = { email: string; full_name: string; role: string; notion_user_id: string | null }
type Account = {
  platform: string
  windsor_connector: string
  external_account_id: string
  account_name: string
  monthly_budget: number | null
  conversion_fields: string[]
  lead_fields: string[]
}
type SeedClient = {
  name: string
  slug: string
  notion_client_option: string
  currency: string
  team: { email: string; role: string }[]
  main_kpi: string
  monthly_kpi_target: number | null
  platform_accounts: Account[]
}

const seed = JSON.parse(readFileSync("seed/clients.json", "utf8")) as { people: Person[]; clients: SeedClient[] }
const checks = parseChecks(readFileSync("seed/checks.md", "utf8"))

async function upsert(table: string, rows: object[], onConflict: string) {
  if (!rows.length) return []
  if (dryRun) {
    console.log(`  [dry run] ${table}: would upsert ${rows.length} row(s) on (${onConflict})`)
    return rows as { id?: string }[]
  }
  const { data, error } = await db.from(table).upsert(rows, { onConflict }).select()
  if (error) throw new Error(`${table}: ${error.message}`)
  console.log(`  ${table}: ${data.length} row(s) upserted`)
  return data as { id?: string }[]
}

async function main() {
  console.log(dryRun ? "DRY RUN: nothing will be written.\n" : "Seeding Supabase (insert/update only, no deletes).\n")
  const emails = new Set(seed.people.map((p) => p.email))
  for (const c of seed.clients) for (const t of c.team) if (!emails.has(t.email)) throw new Error(`${c.name}: ${t.email} is not in "people"`)

  // People: invites apply on first sign-in. People who already signed in get their profile updated.
  await upsert("team_invites", seed.people.map((p) => ({ ...p, email: p.email.toLowerCase() })), "email")
  const { data: profiles } = await db.from("profiles").select("id, email, role").in("email", [...emails])
  for (const p of profiles ?? []) {
    const person = seed.people.find((x) => x.email === p.email)!
    console.log(`  profiles: ${p.email} already signed in, ${p.role ? "keeping role " + p.role : "setting role " + person.role}`)
    if (!dryRun) {
      const { error } = await db
        .from("profiles")
        .update({ full_name: person.full_name, notion_user_id: person.notion_user_id, ...(p.role ? {} : { role: person.role }) })
        .eq("id", p.id)
      if (error) throw new Error(`profiles: ${error.message}`)
    }
  }

  for (const c of seed.clients) {
    console.log(`\n${c.name}`)
    const [client] = await upsert(
      "clients",
      [{ name: c.name, slug: c.slug, notion_client_option: c.notion_client_option, currency: c.currency, main_kpi: c.main_kpi, monthly_kpi_target: c.monthly_kpi_target }],
      "slug",
    )
    const clientId = client.id ?? "(new)"
    await upsert("client_team_invites", c.team.map((t) => ({ client_id: clientId, email: t.email, role: t.role })), "client_id,email,role")
    const members = c.team
      .map((t) => ({ t, profile: profiles?.find((p) => p.email === t.email) }))
      .filter((m) => m.profile)
      .map((m) => ({ client_id: clientId, profile_id: m.profile!.id, role: m.t.role }))
    await upsert("client_team", members, "client_id,profile_id,role")
    await upsert("client_platform_accounts", c.platform_accounts.map((a) => ({ ...a, client_id: clientId })), "platform,external_account_id")
  }

  console.log("\nChecks")
  await upsert("check_definitions", checks, "key")
  console.log(`\nDone. ${seed.clients.length} clients, ${seed.people.length} people, ${checks.length} checks.`)
}

main().catch((e) => {
  console.error("Seed failed:", e.message)
  process.exit(1)
})
