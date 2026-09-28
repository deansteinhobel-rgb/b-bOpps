import "server-only"

/** Slack is on hold (CLAUDE.md). Does nothing unless SLACK_WEBHOOK_URL is set. */
export async function postToSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`)
}
