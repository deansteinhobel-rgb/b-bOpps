/**
 * The weekly snapshot as a Slack message (Dean, 2026-10-20: easy to digest at a glance, with a way
 * into the full report and into a sprint brief to replace weak ads). Plain module: the cron route,
 * Admin's preview and the script all use it. Slack mrkdwn, Block Kit; links only (no Slack
 * interactivity endpoint), so every button opens Lumaux.
 */
import { compactMoney, money, percent, whole } from "@/lib/format"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import type { SlackMessage } from "@/lib/slack"
import type { WeekAd, WeeklySnapshot } from "./weekly"

/** Ads first seen this many days ago or more, with no results over the same 30 days, are "stale". */
export const STALE_DAYS = 30

export type Tone = "green" | "amber" | "red"
/** Cost per result against its target (the glance rule): on target, within 20% over, further over. */
export const cprTone = (cpr: number | null, target: number | null): Tone | null => (cpr === null || !target ? null : cpr <= target ? "green" : cpr <= target * 1.2 ? "amber" : "red")

const DOT: Record<Tone, string> = { green: ":large_green_circle:", amber: ":large_orange_circle:", red: ":red_circle:" }
const dot = (t: Tone | null) => (t ? `${DOT[t]} ` : "")

/** Slack needs &, < and > escaped in text it should show as is. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const q = (name: string) => `“${esc(clip(name))}”`

const day = (iso: string, opts: Intl.DateTimeFormatOptions = {}) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC", ...opts }).format(new Date(`${iso}T00:00:00Z`))
const weekday = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))
const monthName = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`))

/** "↑ 12%" against the week before; nothing when there's nothing to compare with. */
function move(now: number | null, prev: number | null) {
  if (now === null || prev === null || prev === 0) return ""
  const pct = Math.round((now / prev - 1) * 100)
  return pct === 0 ? " · same as the week before" : ` · ${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% on the week before`
}

const resultsWord = (n: number) => (n === 1 ? "result" : "results")
/** How long an ad has run: "77 days", then months past 90 days ("33 months"); "90+ days" when it predates our data. */
const age = (days: number, capped: boolean) => (capped ? "90+ days" : days < 90 ? `${days} days` : `${Math.floor(days / 30.4)} months`)

/** A link Slack can show safely: https only, nothing that breaks its <url|label> markup. */
const safeLink = (url: string | null) => (url && /^https:\/\/[^\s|<>]+$/.test(url) ? url : null)

/** One ad: what it did, its name (linked to the live post where there is one), and its image on the right. */
function adSection(a: WeekAd, label: string, basis: "cost_per_result" | "ctr", m: (v: number | null) => string) {
  const link = safeLink(a.link)
  const name = link ? `<${link}|${q(a.name)}>` : q(a.name)
  const did = basis === "ctr" ? `${percent(a.ctr, 2)} CTR · ${m(a.spend)} spent` : a.results ? `${whole(a.results)} ${resultsWord(a.results)} at ${m(a.cpr)} each · ${m(a.spend)} spent` : `${m(a.spend)} spent, no results`
  const extra = [a.campaign ? esc(clip(a.campaign, 50)) : null, !a.image && a.kind ? a.kind : null].filter(Boolean).join(" · ")
  const block: Record<string, unknown> = { type: "section", text: { type: "mrkdwn", text: `${label} · ${name}
${did}${extra ? `
_${extra}_` : ""}` } }
  if (a.image) block.accessory = { type: "image", image_url: a.image, alt_text: clip(a.name, 100) }
  return block
}

/**
 * `app`: where the buttons go. `icons`: where the platform logos load from (/platforms/*.png, served
 * without sign-in). Slack needs a public https address; "" = this site (Admin's preview); null leaves
 * them out (localhost, which Slack can't reach).
 */
export type MessageLinks = { app: string; icons?: string | null }

export function weeklyMessage(s: WeeklySnapshot, links: MessageLinks): SlackMessage {
  const cur = s.client.currency
  const m = (v: number | null) => money(v, cur)
  const c = (v: number | null) => compactMoney(v, cur)
  const base = `${links.app.replace(/\/$/, "")}/clients/${s.client.slug}`
  const reportUrl = (platform: string) => `${base}/reporting/client-report?platform=${platform}&campaign=all&from=${s.week.from}&to=${s.week.to}`
  const refreshUrl = (platform: string) => `${base}/sprint?refresh=${platform}&week=${s.week.from}`
  const dates = `${weekday(s.week.from)} ${day(s.week.from)} – ${weekday(s.week.to)} ${day(s.week.to)}`

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `${s.client.name} · weekly snapshot`, emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `${dates} · compared with the week before${s.complete ? "" : ` · *data only to ${day(s.dataThrough)}*`}` }] },
  ]

  // The month and the main goal: where we stand, at a glance.
  const lines: string[] = []
  if (s.month) {
    const mo = s.month
    const name = monthName(mo.month)
    if (mo.budget) {
      const pace = mo.variancePct === null ? "" : Math.abs(mo.variancePct) <= 1 ? "right on pace" : `${Math.abs(mo.variancePct)}% ${mo.variancePct > 0 ? "ahead of" : "behind"} pace`
      lines.push(`${dot(mo.tone)}*${name} spend:* ${c(mo.spend)} of ${c(mo.budget)} (${Math.round((mo.spend / mo.budget) * 100)}%) · ${pace}, on pace would be ${c(mo.expected)} by ${day(mo.through)}`)
    } else {
      lines.push(`*${name} spend:* ${c(mo.spend)} so far · no budget set`)
    }
  }
  for (const g of s.goals) {
    if (g.value === null) {
      lines.push(`*${esc(g.name)}:* not entered for ${monthName(g.month)} yet${g.target ? ` · target ${whole(g.target)}` : ""}`)
      continue
    }
    const pace = g.behindPct === null ? "" : Math.abs(g.behindPct) <= 1 ? " · on pace" : ` · ${Math.abs(g.behindPct)}% ${g.behindPct > 0 ? "behind" : "ahead of"} pace (${whole(g.expected)} by ${day(s.week.to)})`
    lines.push(`${dot(g.tone)}*${esc(g.name)}:* ${whole(g.value)}${g.target ? ` of ${whole(g.target)}` : ""} in ${monthName(g.month)}${pace}`)
  }
  if (lines.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } })

  // Last week, all platforms.
  const n = s.now
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Spend (7 days)*\n${c(n.spend)}${move(n.spend, s.prev.spend)}` },
      { type: "mrkdwn", text: `*Results*\n${whole(n.results)}${move(n.results, s.prev.results)}` },
      { type: "mrkdwn", text: `*Cost per result*\n${dot(cprTone(n.cpr, s.target))}${m(n.cpr)}${s.target ? ` · target ${m(s.target)}` : ""}` },
      { type: "mrkdwn", text: `*Clicks*\n${whole(n.clicks)} · ${percent(n.ctr, 2)} CTR` },
    ],
  })

  // Per platform: the numbers, the 2 best and 2 weakest ads (each with its image), then the stale ones.
  for (const p of s.platforms) {
    const label = PLATFORM_LABEL[p.platform]
    const icon = links.icons != null ? `${links.icons.replace(/\/$/, "")}/platforms/${p.platform}.png` : null
    const head = `${icon ? "" : `*${label}* · `}${c(p.now.spend)} · ${whole(p.now.results)} ${resultsWord(p.now.results)}${p.now.results ? ` · ${dot(cprTone(p.now.cpr, p.target))}${m(p.now.cpr)} each` : ""}${p.target ? ` (target ${m(p.target)})` : ""}`
    const empty = !p.best.length && !p.weak.length && !p.stale.count
    blocks.push({ type: "divider" })
    // The platform's logo and name on their own line (Dean, 2026-10-20), then its numbers and ads.
    if (icon) blocks.push({ type: "context", elements: [{ type: "image", image_url: icon, alt_text: label }, { type: "mrkdwn", text: `*${label}*` }] })
    const section: Record<string, unknown> = { type: "section", text: { type: "mrkdwn", text: empty ? `${head}\n\n_Not enough ads with spend to compare._` : head } }
    if (p.weak.length || p.stale.count) {
      section.accessory = { type: "button", text: { type: "plain_text", text: "Replace weak ads" }, url: refreshUrl(p.platform), action_id: `refresh_${p.platform}` }
    }
    blocks.push(section)
    // One line per best and weakest ad, with its image beside it (Dean, 2026-10-20: show the ads).
    blocks.push(...p.best.map((a) => adSection(a, `:arrow_up: *Best${p.bestBasis === "ctr" ? " by CTR" : ""}*`, p.bestBasis, m)))
    blocks.push(...p.weak.map((a) => adSection(a, `:arrow_down: *Weakest${p.weakBasis === "ctr" ? " by CTR" : ""}*`, p.weakBasis, m)))
    if (p.stale.count) {
      const shown = p.stale.ads.map((a) => `• ${q(a.name)} · ${age(a.ageDays, a.ageCapped)} · ${m(a.spend30)}`)
      const more = p.stale.count - p.stale.ads.length
      const text = `:hourglass: *${p.stale.count} ${p.stale.count === 1 ? "ad has" : "ads have"} run ${STALE_DAYS}+ days with no results in ${STALE_DAYS} days* (${c(p.stale.spend30)})\n${shown.join("\n")}${more > 0 ? `\n• and ${more} more` : ""}`
      blocks.push({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2990) } })
    }
  }

  blocks.push({ type: "divider" })
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", style: "primary", text: { type: "plain_text", text: "Open the full report" }, url: reportUrl("all"), action_id: "open_report" },
      ...s.platforms.slice(0, 4).map((p) => ({ type: "button", text: { type: "plain_text", text: `${PLATFORM_LABEL[p.platform]} report` }, url: reportUrl(p.platform), action_id: `open_${p.platform}` })),
    ],
  })
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Lumaux · data to ${day(s.dataThrough)} · "Replace weak ads" plans a sprint test you can brief to Notion` }] })

  // Slack takes at most 50 blocks; drop ad lines from the end if a client ever has more.
  while (blocks.length > 50) {
    const i = blocks.findLastIndex((b) => (b as { text?: { text?: string } }).text?.text?.startsWith(":arrow_"))
    if (i < 0) break
    blocks.splice(i, 1)
  }
  const text = `${s.client.name} weekly snapshot, ${dates}: ${c(n.spend)} spent, ${whole(n.results)} ${resultsWord(n.results)} at ${m(n.cpr)} each.`
  return { text, blocks }
}
