import "server-only"
import { Client } from "@notionhq/client"
import { createAdminClient } from "@/lib/supabase/admin"
import { postToSlack } from "@/lib/slack"
import { dataSourceId, liveClientSlugs, NOTION_VERSION } from "./config"
import type { WriteDb, WriteDeps } from "./write"

/**
 * Both switches must be flipped by Dean before anything reaches Notion. Pass a client slug to also
 * apply NOTION_LIVE_CLIENTS (while it's set, only those clients are written for real).
 */
export function notionWritesLive(clientSlug?: string) {
  const on = process.env.NOTION_WRITES_ENABLED === "true" && process.env.NOTION_DRY_RUN === "false"
  const only = liveClientSlugs()
  return on && (!clientSlug || !only || only.includes(clientSlug.toLowerCase()))
}

/**
 * Production dependencies for createNotionAction. A real Notion client is only constructed when
 * writes are live; in dry run there is no client that could write at all.
 */
export function writeDeps(): WriteDeps {
  const live = notionWritesLive()
  const token = process.env.NOTION_TOKEN
  return {
    db: createAdminClient() as unknown as WriteDb,
    notion: live && token ? new Client({ auth: token, notionVersion: NOTION_VERSION }) : null,
    env: {
      writesEnabled: process.env.NOTION_WRITES_ENABLED === "true",
      dryRun: process.env.NOTION_DRY_RUN !== "false",
      dataSourceId: dataSourceId(),
      appUrl: process.env.APP_URL ?? "http://localhost:3000",
      liveClients: liveClientSlugs(),
    },
    notifySlack: postToSlack,
  }
}
