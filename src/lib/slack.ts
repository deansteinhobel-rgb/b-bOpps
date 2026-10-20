import "server-only"

/**
 * Slack (Dean, 2026-10-20): the Lumaux Slack app posts the weekly reports, nothing else. It posts as
 * its bot (scope chat:write only) to channels it has been invited to. SLACK_BOT_TOKEN is server-side
 * only. Fixed URL, so no allowlist is needed.
 */
export type SlackMessage = { text: string; blocks: unknown[] }

export const slackConfigured = () => Boolean(process.env.SLACK_BOT_TOKEN)

/** The channel a client's reports go to: its own (Admin → client), else the reporting channel. */
export const reportChannel = (clientChannel: string | null | undefined) => clientChannel?.trim() || process.env.SLACK_REPORT_CHANNEL?.trim() || null

/** Posts a message and returns its timestamp. Throws with Slack's error code when Slack refuses it. */
export async function postSlackMessage(channel: string, msg: SlackMessage): Promise<{ ts: string }> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error("SLACK_BOT_TOKEN isn't set.")
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text: msg.text, blocks: msg.blocks, unfurl_links: false, unfurl_media: false }),
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; ts?: string; error?: string } | null
  if (!res.ok || !body?.ok || !body.ts) throw new Error(`Slack: ${body?.error ?? `HTTP ${res.status}`}`)
  return { ts: body.ts }
}
