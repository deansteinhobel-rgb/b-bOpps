import Link from "next/link"
import { Fragment, type ReactNode } from "react"
import { ClientLogo } from "@/components/brand"
import { longDate } from "@/lib/format"
import { appUrl, slackReportsLive } from "@/lib/reports/send"
import { snapshotImages } from "@/lib/reports/snapshot-images"
import { weeklyMessage } from "@/lib/reports/weekly-message"
import { lastWeek, weeklySnapshot } from "@/lib/reports/weekly"
import { reportChannel, slackConfigured } from "@/lib/slack"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { SendNowButton } from "./send-button"

export const metadata = { title: "Slack reports" }

const EMOJI: Record<string, string> = { large_green_circle: "🟢", large_orange_circle: "🟠", red_circle: "🔴", arrow_up: "⬆️", arrow_down: "⬇️", hourglass: "⌛" }

/** Slack mrkdwn as it will look: *bold*, _italic_, <link|label>, the emoji we use, escaped &, < and >. */
function Mrkdwn({ text }: { text: string }) {
  const plain = text.replace(/:([a-z_]+):/g, (m, k: string) => EMOJI[k] ?? m)
  const parts: ReactNode[] = []
  const re = /<(https:[^|>]+)\|([^>]+)>|\*([^*\n]+)\*|_([^_\n]+)_/g
  let at = 0
  for (const m of plain.matchAll(re)) {
    parts.push(plain.slice(at, m.index))
    parts.push(
      m[1] ? (
        <a key={m.index} href={m[1]} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
          {m[2]}
        </a>
      ) : m[3] ? (
        <strong key={m.index} className="font-semibold text-foreground">{m[3]}</strong>
      ) : (
        <em key={m.index}>{m[4]}</em>
      ),
    )
    at = m.index + m[0].length
  }
  parts.push(plain.slice(at))
  const unescape = (n: ReactNode) => (typeof n === "string" ? n.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : n)
  return <span className="whitespace-pre-line">{parts.map((p, i) => <Fragment key={i}>{unescape(p)}</Fragment>)}</span>
}

type Block = { type: string; title?: { text: string }; image_url?: string; alt_text?: string; text?: { text: string }; fields?: { text: string }[]; elements?: { type?: string; text?: string | { text: string }; url?: string; style?: string; image_url?: string; alt_text?: string }[]; accessory?: { type: string; text?: { text: string }; url?: string; image_url?: string; alt_text?: string } }

function SlackPreview({ blocks }: { blocks: Block[] }) {
  return (
    <div className="surface space-y-3 p-5 text-sm text-body">
      {blocks.map((b, i) => {
        if (b.type === "header") return <p key={i} className="text-lg font-bold text-foreground">{b.text?.text}</p>
        if (b.type === "divider") return <hr key={i} className="border-border" />
        if (b.type === "image")
          return (
            <figure key={i} className="space-y-1">
              <figcaption className="text-xs text-muted-foreground">{b.title?.text}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element -- the picture exactly as Slack gets it */}
              <img src={b.image_url} alt={b.alt_text ?? ""} className="w-full max-w-[600px] rounded-lg border border-border" />
            </figure>
          )
        if (b.type === "context")
          return (
            <p key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              {b.elements?.map((e, j) =>
                e.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the same logo Slack shows
                  <img key={j} src={e.image_url} alt={e.alt_text ?? ""} className="size-4 rounded-sm" />
                ) : (
                  <Mrkdwn key={j} text={typeof e.text === "string" ? e.text : (e.text?.text ?? "")} />
                ),
              )}
            </p>
          )
        if (b.type === "actions")
          return (
            <div key={i} className="flex flex-wrap gap-2">
              {b.elements?.map((e, j) => (
                <a key={j} href={e.url} className={cn("rounded-md border px-3 py-1 text-[13px] font-medium", e.style === "primary" ? "border-transparent bg-[#007a5a] text-white" : "border-border-strong text-foreground")}>
                  {typeof e.text === "string" ? e.text : e.text?.text}
                </a>
              ))}
            </div>
          )
        return (
          <div key={i} className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              {b.text && <Mrkdwn text={b.text.text} />}
              {b.fields && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {b.fields.map((f, j) => (
                    <div key={j}><Mrkdwn text={f.text} /></div>
                  ))}
                </div>
              )}
            </div>
            {b.accessory?.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- the ad image exactly as Slack gets it
              <img src={b.accessory.image_url} alt={b.accessory.alt_text ?? ""} className="size-20 shrink-0 rounded-md object-cover" />
            ) : b.accessory ? (
              <a href={b.accessory.url} className="shrink-0 rounded-md border border-border-strong px-3 py-1 text-[13px] font-medium text-foreground">
                {b.accessory.text?.text}
              </a>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

const STATUS_CLS: Record<string, string> = { sent: "text-rag-green", failed: "text-rag-red", dry_run: "text-muted-foreground", sending: "text-rag-amber" }
const STATUS_LABEL: Record<string, string> = { sent: "Sent", failed: "Failed", dry_run: "Dry run", sending: "Sending" }

/**
 * Admin → Slack (Dean, 2026-10-20): the weekly snapshot as it will be posted on Monday, per client, with
 * a test send and the log of posts. The scheduled post is on Mondays from 08:00 London, 10 minutes apart.
 */
export default async function SlackAdminPage({ searchParams }: PageProps<"/admin/slack">) {
  const { client: slug } = await searchParams
  const supabase = await createClient()
  const { data: clients } = await supabase.from("clients").select("id, slug, name, logo_url, slack_channel, client_platform_accounts!inner(id)").eq("active", true).eq("client_platform_accounts.active", true).order("name")
  const list = [...new Map((clients ?? []).map((c) => [c.id, c])).values()]
  const picked = list.find((c) => c.slug === slug) ?? list.find((c) => c.slug === "dnsfilter") ?? list[0]
  const week = lastWeek()
  const admin = createAdminClient()
  // Access confirmed above: the client list came through RLS (admins see every client).
  const [snap, { data: posts }] = await Promise.all([
    picked ? weeklySnapshot(admin, picked.id, week) : null,
    supabase.from("slack_posts").select("id, client_id, period_start, status, manual, channel, error, created_at, profiles(full_name)").order("created_at", { ascending: false }).limit(30),
  ])
  // The pictures as Slack will show them, drawn here (a few seconds) and shown inline.
  const pics = snap ? await snapshotImages(snap, appUrl()).catch(() => null) : null
  const asUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`
  const message = snap ? weeklyMessage(snap, { app: appUrl(), icons: "", images: pics ? { snapshot: asUri(pics.snapshot), ads: asUri(pics.ads) } : null }) : null
  const channel = picked ? reportChannel(picked.slack_channel) : null
  const live = picked ? slackReportsLive(picked.slug) : false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Slack reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every Monday from 08:00 London, one post per client with ad data, 10 minutes apart: last week ({longDate(week.from)} – {longDate(week.to)}), the month against budget, the main goal, and the best, weakest and stale ads per platform.
        </p>
      </div>

      <ul className="surface divide-y text-sm">
        <li className="flex justify-between gap-4 px-5 py-3"><span>Slack app (SLACK_BOT_TOKEN)</span><span className={slackConfigured() ? "text-rag-green" : "text-rag-red"}>{slackConfigured() ? "Connected" : "Not set"}</span></li>
        <li className="flex justify-between gap-4 px-5 py-3"><span>Reporting channel (SLACK_REPORT_CHANNEL, or the client&apos;s own)</span><span className={channel ? "text-foreground" : "text-rag-red"}>{channel ?? "Not set"}</span></li>
        <li className="flex justify-between gap-4 px-5 py-3"><span>Monday posts for {picked?.name ?? "this client"} (SLACK_REPORTS_ENABLED, SLACK_LIVE_CLIENTS)</span><span className={live ? "text-rag-green" : "text-muted-foreground"}>{live ? "On" : "Off: logged as a dry run"}</span></li>
      </ul>

      <nav className="flex flex-wrap gap-2" aria-label="Clients">
        {list.map((c) => (
          <Link key={c.id} href={`/admin/slack?client=${c.slug}`} aria-current={c.id === picked?.id ? "page" : undefined} className={cn("pill inline-flex items-center gap-2", c.id === picked?.id && "pill-active")}>
            <ClientLogo name={c.name} logoUrl={c.logo_url} className="size-5" />
            {c.name}
          </Link>
        ))}
      </nav>

      {picked && !message && <p className="text-sm text-muted-foreground">No ad data for {picked.name} yet.</p>}
      {picked && message && (
        <div className="space-y-3">
          <SlackPreview blocks={message.blocks as Block[]} />
          <SendNowButton clientId={picked.id} channel={channel} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-2xl">Posts</h2>
        <ul className="surface divide-y text-sm">
          {!posts?.length && <li className="px-5 py-8 text-center text-muted-foreground">Nothing posted yet.</li>}
          {(posts ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <span className="w-40">{list.find((c) => c.id === p.client_id)?.name ?? "Client"}</span>
              <span className="text-muted-foreground">Week of {longDate(p.period_start)}</span>
              <span className={STATUS_CLS[p.status]}>{STATUS_LABEL[p.status] ?? p.status}</span>
              <span className="text-muted-foreground">{p.manual ? `Test by ${(p.profiles as unknown as { full_name: string | null } | null)?.full_name ?? "an admin"}` : "Scheduled"}</span>
              <span className="text-muted-foreground">{new Date(p.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })}</span>
              {p.error && <span className="w-full text-xs text-rag-red">{p.error}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
