/**
 * Run the Notion mirror sync from the command line. READ-ONLY towards Notion.
 *   pnpm sync:notion          # incremental (a full sync the first time)
 *   pnpm sync:notion --full   # full reconcile
 */
import { syncNotionMirror } from "@/lib/notion/sync"

const started = Date.now()
syncNotionMirror({ full: process.argv.includes("--full") })
  .then((r) => console.log(`${r.mode} sync: ${r.pages} pages (${r.mapped} mapped to a client), ${r.trashed} marked trashed, ${((Date.now() - started) / 1000).toFixed(1)}s`))
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
