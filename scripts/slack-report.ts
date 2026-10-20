/**
 * Prints a client's weekly Slack snapshot (last Monday to Sunday) without sending it. Reads only.
 *   pnpm slack:report dnsfilter          # the message as text
 *   pnpm slack:report dnsfilter --json   # the Block Kit JSON (paste into Slack's Block Kit Builder)
 */
import { iconBase } from "@/lib/reports/send"
import { weeklyMessage } from "@/lib/reports/weekly-message"
import { weeklySnapshot } from "@/lib/reports/weekly"
import { createAdminClient } from "@/lib/supabase/admin"

const slug = process.argv[2]
const json = process.argv.includes("--json")
async function main() {
  if (!slug) throw new Error("Usage: pnpm slack:report <client slug> [--json]")
  const admin = createAdminClient()
  const { data: client } = await admin.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) throw new Error(`No client "${slug}".`)
  const snap = await weeklySnapshot(admin, client.id)
  if (!snap) throw new Error("No ad data for this client.")
  const msg = weeklyMessage(snap, { app: process.env.APP_URL ?? "http://localhost:3000", icons: iconBase() ?? "https://bbmopsapp.vercel.app" })
  if (json) return console.log(JSON.stringify({ blocks: msg.blocks }, null, 2))
  console.log(msg.text, "\n")
  for (const b of msg.blocks as Record<string, any>[]) {
    if (b.type === "divider") console.log("────────")
    else if (b.type === "header") console.log(`# ${b.text.text}`)
    else if (b.type === "context") console.log(b.elements.map((e: { text?: string; alt_text?: string }) => e.text ?? `[${e.alt_text} logo]`).join(" "))
    else if (b.type === "section") {
      if (b.text) console.log(b.text.text)
      if (b.fields) console.log(b.fields.map((f: { text: string }) => f.text.replaceAll("\n", ": ")).join("\n"))
      if (b.accessory) console.log(b.accessory.type === "image" ? `[image] ${String(b.accessory.image_url).slice(0, 70)}…` : `[${b.accessory.text.text}] ${b.accessory.url}`)
    } else if (b.type === "actions") console.log(b.elements.map((e: { text: { text: string }; url: string }) => `[${e.text.text}] ${e.url}`).join("\n"))
    console.log()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
