/**
 * Fetches each client's icon from its website (via Google's favicon service, 128px) into the public
 * "brand" bucket and sets clients.logo_url. Skips clients whose logo_url is set by hand.
 *   pnpm fetch:logos [--force]
 */
import { createAdminClient } from "@/lib/supabase/admin"

const force = process.argv.includes("--force")
const db = createAdminClient()

async function main() {
  const { data: clients } = await db.from("clients").select("id, slug, website, logo_url")
  for (const c of clients ?? []) {
    if (!c.website) {
      console.log(`${c.slug}: no website set, skipped`)
      continue
    }
    if (c.logo_url && !force && !c.logo_url.includes("/brand/")) {
      console.log(`${c.slug}: custom logo set, skipped`)
      continue
    }
    const domain = c.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`)
    if (!res.ok) {
      console.log(`${c.slug}: icon fetch failed (${res.status})`)
      continue
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    const path = `logos/${c.id}.png`
    const { error } = await db.storage.from("brand").upload(path, bytes, { contentType: "image/png", upsert: true })
    if (error) {
      console.log(`${c.slug}: upload failed (${error.message})`)
      continue
    }
    const { data } = db.storage.from("brand").getPublicUrl(path)
    await db.from("clients").update({ logo_url: `${data.publicUrl}?v=${Date.now()}` }).eq("id", c.id)
    console.log(`${c.slug}: logo saved (${bytes.byteLength} bytes)`)
  }
}

main()
