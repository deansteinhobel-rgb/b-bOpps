import "server-only"
import type { Db } from "@/lib/supabase/db"
import { liveClientSlugs } from "@/lib/notion/config"
import { postSlackMessage, reportChannel, slackConfigured, type SlackMessage } from "@/lib/slack"
import { snapshotImages } from "./snapshot-images"
import { weeklyMessage, type SnapshotImageLinks } from "./weekly-message"
import type { WeeklySnapshot } from "./weekly"
import { lastWeek, weeklySnapshot } from "./weekly"
import { toJson } from "@/lib/supabase/db"

/**
 * Sending the weekly snapshot (Dean, 2026-10-20). Like the Notion write: a slack_posts row is written
 * first ('sending'), then Slack is called, then the row gets the result. The scheduled post only goes to
 * Slack when SLACK_REPORTS_ENABLED=true, the bot token is set and the client is in SLACK_LIVE_CLIENTS
 * (when that's set); otherwise it's logged as a dry run. A manual send from Admin (a test) needs the
 * token and a channel only, and never counts as the week's post.
 *
 * `db` must be the admin client: slack_posts is server-written.
 */
export const SLACK_IMAGE_TTL = 90 * 24 * 3600

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
/** Platform logos for Slack: only from a public https address (Slack can't load localhost). */
export const iconBase = () => (appUrl().startsWith("https://") ? appUrl() : null)

const IMAGE_BUCKET = "report-images"

/**
 * Draws the pictures (the client snapshot, one per platform) and stores them (private bucket, 90-day
 * signed links Slack can load). Null when drawing or storing fails: the post then falls back to the text
 * version, so a Monday post never fails on a picture.
 */
export async function storedSnapshotImages(db: Db, snap: WeeklySnapshot): Promise<SnapshotImageLinks | null> {
  try {
    const pics = await snapshotImages(snap, appUrl())
    const stamp = Date.now()
    const store = async (kind: string, buf: Buffer) => {
      const path = `${snap.client.id}/${snap.week.from}/${kind}-${stamp}.png`
      const up = await db.storage.from(IMAGE_BUCKET).upload(path, buf, { contentType: "image/png", upsert: false })
      if (up.error) throw new Error(up.error.message)
      const { data, error } = await db.storage.from(IMAGE_BUCKET).createSignedUrl(path, SLACK_IMAGE_TTL)
      if (error || !data) throw new Error(error?.message ?? "no signed link")
      return data.signedUrl
    }
    return {
      snapshot: await store("snapshot", pics.snapshot),
      platforms: await Promise.all(pics.platforms.map(async (p) => ({ platform: p.platform, url: await store(`ads-${p.platform}`, p.png) }))),
    }
  } catch (e) {
    console.error("[slack] snapshot pictures", e)
    return null
  }
}

export function slackReportsLive(slug: string) {
  if (process.env.SLACK_REPORTS_ENABLED !== "true" || !slackConfigured()) return false
  const only = liveClientSlugs(process.env.SLACK_LIVE_CLIENTS)
  return !only || only.includes(slug.toLowerCase())
}

export type SendResult = { status: "sent" | "dry_run" | "failed" | "skipped"; client: string; error?: string; message?: SlackMessage }

export async function sendWeeklySnapshot(db: Db, clientId: string, opts: { manual?: boolean; by?: string | null; week?: { from: string; to: string } } = {}): Promise<SendResult> {
  const week = opts.week ?? lastWeek()
  const { data: client } = await db.from("clients").select("id, slug, slack_channel").eq("id", clientId).single()
  if (!client) return { status: "failed", client: clientId, error: "No such client." }
  // The ad images stay viewable in Slack for 90 days (signed links to our private copies).
  const snap = await weeklySnapshot(db, clientId, week, SLACK_IMAGE_TTL)
  if (!snap) return { status: "skipped", client: client.slug, error: "No ad data." }
  const channel = reportChannel(client.slack_channel)
  const live = opts.manual ? slackConfigured() && Boolean(channel) : slackReportsLive(client.slug) && Boolean(channel)
  // Pictures only for posts that really go to Slack (a dry run doesn't store anything).
  const images = live ? await storedSnapshotImages(db, snap) : null
  const message = weeklyMessage(snap, { app: appUrl(), icons: iconBase(), images })

  const { data: row, error } = await db
    .from("slack_posts")
    .insert({ client_id: clientId, period_start: week.from, period_end: week.to, channel, manual: Boolean(opts.manual), status: live ? "sending" : "dry_run", message: toJson(message), sent_by: opts.by ?? null, finished_at: live ? null : new Date().toISOString() })
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
