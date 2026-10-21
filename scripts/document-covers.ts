/**
 * LinkedIn document ads: copy each one's first page from its public post page, in place of the
 * generic document tile Windsor gives. Each ad is done once (see copyDocumentCovers). Reads LinkedIn's
 * public post pages; writes only our database and storage.
 *   pnpm covers:documents            # every client
 *   pnpm covers:documents camber     # one client
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { copyDocumentCovers } from "@/lib/windsor/creatives"

async function main() {
  const slug = process.argv[2]
  let clientId: string | undefined
  if (slug) {
    const { data } = await createAdminClient().from("clients").select("id").eq("slug", slug).maybeSingle()
    if (!data) throw new Error(`No client with slug ${slug}`)
    clientId = data.id
  }
  const started = Date.now()
  const r = await copyDocumentCovers({ clientId, max: 500, pauseMs: 2000 })
  console.log(`${r.checked} document ads checked: ${r.copied} covers saved, ${r.failed} without one. Done in ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
