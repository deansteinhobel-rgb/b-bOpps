/**
 * Sends a client's weekly Slack snapshot now, as a test (manual: logged in slack_posts, never counts as
 * the week's Monday post). Needs SLACK_BOT_TOKEN and a channel (SLACK_REPORT_CHANNEL or the client's own).
 *   pnpm slack:send dnsfilter
 */
import { sendWeeklySnapshot } from "@/lib/reports/send"
import { createAdminClient } from "@/lib/supabase/admin"

const slug = process.argv[2]
async function main() {
  if (!slug) throw new Error("Usage: pnpm slack:send <client slug>")
  const admin = createAdminClient()
  const { data: client } = await admin.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) throw new Error(`No client "${slug}".`)
  const r = await sendWeeklySnapshot(admin, client.id, { manual: true })
  console.log(r.status === "sent" ? `Sent ${slug}'s snapshot to Slack.` : `Not sent (${r.status}): ${r.error ?? "no Slack token or channel"}`)
  if (r.status !== "sent") process.exit(1)
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
