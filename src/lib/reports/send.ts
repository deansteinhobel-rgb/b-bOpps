import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { liveClientSlugs } from "@/lib/notion/config"
import { postSlackMessage, reportChannel, slackConfigured, type SlackMessage } from "@/lib/slack"
import { weeklyMessage } from "./weekly-message"
import { lastWeek, weeklySnapshot } from "./weekly"

/**
 * Sending the weekly snapshot (Dean, 2026-10-20). Like the Notion write: a slack_posts row is written
 * first ('sending'), then Slack is called, then the row gets the result. The scheduled post only goes to
 * Slack when SLACK_REPORTS_ENABLED=true, the bot token is set and the client is in SLACK_LIVE_CLIENTS
 * (when that's set); otherwise it's logged as a dry run. A manual send from Admin (a test) needs the
 * token and a channel only, and never counts as the week's post.
 *
 * `db` must be the admin client: slack_posts is server-written.
 */
export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
/** Platform logos for Slack: only from a public https address (Slack can't load localhost). */
export const iconBase = () => (appUrl().startsWith("https://") ? appUrl() : null)

export function slackReportsLive(slug: string) {
  if (process.env.SLACK_REPORTS_ENABLED !== "true" || !slackConfigured()) return false
  const only = liveClientSlugs(process.env.SLACK_LIVE_CLIENTS)
  return !only || only.includes(slug.toLowerCase())
}

export type SendResult = { status: "sent" | "dry_run" | "failed" | "skipped"; client: string; error?: string; message?: SlackMessage }

export async function sendWeeklySnapshot(db: SupabaseClient, clientId: string, opts: { manual?: boolean; by?: string | null; week?: { from: string; to: string } } = {}): Promise<SendResult> {
  const week = opts.week ?? lastWeek()
  const { data: client } = await db.from("clients").select("id, slug, slack_channel").eq("id", clientId).single()
  if (!client) return { status: "failed", client: clientId, error: "No such client." }
  const snap = await weeklySnapshot(db, clientId, week)
  if (!snap) return { status: "skipped", client: client.slug, error: "No ad data." }
  const message = weeklyMessage(snap, { app: appUrl(), icons: iconBase() })
  const channel = reportChannel(client.slack_channel)
  const live = opts.manual ? slackConfigured() && Boolean(channel) : slackReportsLive(client.slug) && Boolean(channel)

  const { data: row, error } = await db
    .from("slack_posts")
    .insert({ client_id: clientId, period_start: week.from, period_end: week.to, channel, manual: Boolean(opts.manual), status: live ? "sending" : "dry_run", message, sent_by: opts.by ?? null, finished_at: live ? null : new Date().toISOString() })
    .select("id")
    .single()
  // The unique index: this week's post is already sending or sent.
  if (error) return { status: "skipped", client: client.slug, error: error.code === "23505" ? "Already posted this week." : error.message }
  if (!live) return { status: "dry_run", client: client.slug, message, error: !channel ? "No Slack channel set." : undefined }

  try {
    const { ts } = await postSlackMessage(channel!, message)
    await db.from("slack_posts").update({ status: "sent", slack_ts: ts, finished_at: new Date().toISOString() }).eq("id", row.id)
    return { status: "sent", client: client.slug, message }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from("slack_posts").update({ status: "failed", error: msg.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", row.id)
    return { status: "failed", client: client.slug, error: msg }
  }
}
