/**
 * Uploads a licensed brand font into the public "brand" bucket (fonts/<file name>). The font files
 * stay out of the repo (it's public on GitHub); get them from the B&B web team or George's design
 * system, then:
 *   pnpm upload:font path/to/MADEAvenue-Regular.otf
 * globals.css loads MADE Avenue from that bucket (see the @font-face there).
 */
import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { createAdminClient } from "@/lib/supabase/admin"

const TYPES: Record<string, string> = { otf: "font/otf", ttf: "font/ttf", woff: "font/woff", woff2: "font/woff2" }

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("Usage: pnpm upload:font <font file>")
  const name = basename(file)
  const type = TYPES[name.split(".").pop()?.toLowerCase() ?? ""]
  if (!type) throw new Error(`Not a font file: ${name}`)
  const db = createAdminClient()
  const path = `fonts/${name}`
  const { error } = await db.storage.from("brand").upload(path, readFileSync(file), { contentType: type, cacheControl: "31536000", upsert: true })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  console.log(db.storage.from("brand").getPublicUrl(path).data.publicUrl)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
