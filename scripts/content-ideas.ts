/**
 * Content ideas for one client, from the command line (same as "Get content ideas" on At a glance).
 * Writes only to content_idea_runs in our database. Reads ad data, the brief and the Notion mirror.
 *   pnpm ideas:content proactis
 */
import { runContentIdeas, startContentIdeas } from "@/lib/content/generate"
import { createAdminClient } from "@/lib/supabase/admin"

const slug = process.argv[2]
if (!slug) throw new Error("Usage: pnpm ideas:content <client slug>")
const db = createAdminClient()
const { data: client } = await db.from("clients").select("id, name").eq("slug", slug).single()
if (!client) throw new Error(`No client "${slug}".`)
const t = Date.now()
const runId = await startContentIdeas(client.id, null)
await runContentIdeas(runId)
const { data: run } = await db.from("content_idea_runs").select("status, error, headline, working, ideas, avoid, usage").eq("id", runId).single()
console.log(JSON.stringify({ client: client.name, seconds: Math.round((Date.now() - t) / 1000), ...run }, null, 2))
