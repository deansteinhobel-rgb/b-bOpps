"use client"

import { usePathname } from "next/navigation"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { X } from "lucide-react"
import { WinePour } from "@/components/fx/wine-pour"
import { Button } from "@/components/ui/button"
import { NEWS_STARTERS } from "@/lib/ai/news-starters"
import { CAMPAIGN_STARTERS, WEEKLY_READ } from "@/lib/insights/campaign-starters"
import { cn } from "@/lib/utils"

type Msg = { role: "user" | "assistant"; content: string; sources?: { url: string; title: string }[]; error?: boolean; cachedAt?: string }
type Mode = "campaign" | "news"
type Campaign = { slug: string; platform: string; campaignId: string }

/** Open the Ask panel from anywhere: `window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { mode, question } }))`. */
export const ASK_EVENT = "lumaux:ask"

const CAMPAIGN_PATH = /^\/clients\/([a-z0-9-]+)\/reporting\/(linkedin|google_ads|meta)\/([^/?#]+)/

/**
 * One Ask (new layout, Dean 2026-09-30): a single floating chat that knows where you are. On a
 * campaign's page it asks about that campaign (the same /api/campaign-chat as "Ask about this
 * campaign", weekly read shared per week); everywhere, it can ask the news cellar (/api/news-chat, no
 * client data sent). Nothing new is stored: each mode keeps its own rules.
 */
export function AskChat({ aiReady }: { aiReady: boolean }) {
  const pathname = usePathname()
  const m = pathname.match(CAMPAIGN_PATH)
  const campaign: Campaign | null = m ? { slug: m[1], platform: m[2], campaignId: decodeURIComponent(m[3]) } : null
  const campaignKey = campaign ? `${campaign.slug}/${campaign.platform}/${campaign.campaignId}` : null

  const [open, setOpen] = useState(false)
  // The mode you picked, for the page you picked it on. A new page starts on its own default:
  // the campaign on a campaign's page, the news everywhere else.
  const [picked, setPicked] = useState<{ on: string | null; mode: Mode } | null>(null)
  const mode: Mode = picked && picked.on === campaignKey ? picked.mode : campaign ? "campaign" : "news"
  const setMode = (v: Mode) => setPicked({ on: campaignKey, mode: v })
  // One conversation per campaign, and one for the news.
  const [threads, setThreads] = useState<Record<string, Msg[]>>({})
  const [input, setInput] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const active: Mode = mode === "campaign" && campaign ? "campaign" : "news"
  const thread = active === "campaign" ? campaignKey! : "news"
  const msgs = useMemo(() => threads[thread] ?? [], [threads, thread])

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [msgs, status])

  const ask = async (q: string, fresh = false, as: Mode = active) => {
    const question = q.trim()
    if (!question || busy) return
    const key = as === "campaign" && campaignKey ? campaignKey : "news"
    const before = threads[key] ?? []
    const history: Msg[] = [...(fresh ? [] : before.filter((x) => !x.error)), { role: "user", content: question }]
    const set = (next: Msg[] | ((all: Msg[]) => Msg[])) => setThreads((t) => ({ ...t, [key]: typeof next === "function" ? next(t[key] ?? []) : next }))
    set([...history, { role: "assistant", content: "" }])
    setInput("")
    setBusy(true)
    setStatus(as === "campaign" ? "Reading the campaign…" : "Uncorking the news…")
    const patch = (fn: (x: Msg) => Msg) => set((all) => [...all.slice(0, -1), fn(all[all.length - 1])])
    try {
      const messages = history.map(({ role, content }) => ({ role, content }))
      const res = await fetch(as === "campaign" ? "/api/campaign-chat" : "/api/news-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(as === "campaign" && campaign ? { clientSlug: campaign.slug, platform: campaign.platform, campaignId: campaign.campaignId, fresh, messages } : { fresh, messages }),
      })
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => "Couldn't reach Claude."))
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          const ev = JSON.parse(line) as { type: string; text?: string; sources?: Msg["sources"]; at?: string }
          if (ev.type === "status") setStatus(ev.text ?? null)
          if (ev.type === "text") {
            setStatus(null)
            patch((x) => ({ ...x, content: x.content + (ev.text ?? "") }))
          }
          if (ev.type === "sources") patch((x) => ({ ...x, sources: ev.sources }))
          if (ev.type === "cached") patch((x) => ({ ...x, cachedAt: ev.at }))
          if (ev.type === "error") patch((x) => ({ ...x, content: ev.text ?? "Something went wrong.", error: true }))
        }
      }
    } catch (e) {
      patch((x) => ({ ...x, content: (e as Error).message || "Something went wrong.", error: true }))
    }
    setBusy(false)
    setStatus(null)
  }

  // Other parts of the page (e.g. the campaign page's "Ask about this campaign" card) open it.
  const askRef = useRef(ask)
  useLayoutEffect(() => {
    askRef.current = ask
  })
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<{ mode?: Mode; question?: string }>).detail ?? {}
      const as: Mode = d.mode === "campaign" && campaignKey ? "campaign" : d.mode ?? "news"
      setPicked({ on: campaignKey, mode: as })
      setOpen(true)
      if (d.question) void askRef.current(d.question, false, as)
    }
    window.addEventListener(ASK_EVENT, onAsk)
    return () => window.removeEventListener(ASK_EVENT, onAsk)
  }, [campaignKey])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border border-lime/30 bg-card py-2 pr-4 pl-2 text-sm shadow-lg shadow-black/40 transition-colors hover:border-lime/60"
        aria-label={campaign ? "Ask about this campaign or the latest paid media news" : "Ask about the latest paid media news"}
      >
        <WinePour progress={0.7} pouring={false} className="h-8 w-7 text-foreground" />
        <span className="text-left leading-tight">
          <span className="block font-medium">Ask</span>
          <span className="block text-[11px] text-muted-foreground">{campaign ? "about this campaign" : "what's new in paid media"}</span>
        </span>
      </button>
    )
  }

  const starters = active === "campaign" ? CAMPAIGN_STARTERS : NEWS_STARTERS
  return (
    <div className="fixed right-4 bottom-4 z-40 flex h-[min(640px,calc(100dvh-2rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/50" role="dialog" aria-label="Ask">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 space-y-2">
          <p className="font-heading text-lg leading-tight">Ask</p>
          {campaign && (
            <div className="flex gap-1" role="radiogroup" aria-label="Ask about">
              {(
                [
                  ["campaign", "This campaign"],
                  ["news", "Paid media news"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={active === v} onClick={() => setMode(v)} className={cn("rounded-md px-2.5 py-1 text-xs transition-colors", active === v ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {active === "campaign" ? "Claude reads 12 weeks of this campaign's numbers, its ads, open insights, its goal and the client brief." : "Google · Bing · LinkedIn · Meta · Reddit · ChatGPT Ads · X, fresh from the web. No client data is sent."}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {msgs.length > 0 && !busy && (
            <Button size="sm" variant="ghost" onClick={() => setThreads((t) => ({ ...t, [thread]: [] }))}>
              Start over
            </Button>
          )}
          <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {msgs.length === 0 && (
          <div className="space-y-3">
            <p className="text-muted-foreground">{active === "campaign" ? "Ask anything about this campaign, or start with this week's read." : "Ask about new campaign types, bidding, targeting or features on any platform. I'll search and cite sources."}</p>
            <div className="flex flex-wrap gap-2">
              {starters.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!aiReady}
                  onClick={() => ask(s)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50",
                    active === "campaign" && s === WEEKLY_READ ? "border-lime/40 bg-lime/10 text-foreground hover:bg-lime/15" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((x, i) =>
          x.role === "user" ? (
            <p key={i} className="ml-8 rounded-lg bg-accent px-3 py-2">
              {x.content}
            </p>
          ) : (
            <div key={i} className={cn("space-y-2", x.error && "text-rag-red")}>
              {x.content && (
                <div className="space-y-2 leading-relaxed [&_a]:underline [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc">
                  <ReactMarkdown components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{x.content}</ReactMarkdown>
                </div>
              )}
              {x.cachedAt && (
                <p className="text-[11px] text-muted-foreground">
                  {active === "campaign" ? `This week's read, shared with the team (written ${stamp(x.cachedAt)}).` : `Shared answer from ${ago(x.cachedAt)}, kept for 7 days to save tokens.`}{" "}
                  {i === 1 && !busy && (
                    <button type="button" onClick={() => ask(msgs[0].content, true)} className="underline hover:text-foreground">
                      {active === "campaign" ? "Get a fresh read" : "Get a fresh answer"}
                    </button>
                  )}
                </p>
              )}
              {x.sources && x.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {x.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="max-w-full truncate rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground" title={s.title}>
                      {hostname(s.url)}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {status && (
          <p className="flex items-center gap-2 text-xs text-lime" aria-live="polite">
            <span className="size-1.5 animate-pulse rounded-full bg-lime" /> {status}
          </p>
        )}
        <div ref={end} />
      </div>

      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!aiReady}
          placeholder={!aiReady ? "Add ANTHROPIC_API_KEY to switch this on" : active === "campaign" ? "Ask anything about this campaign…" : "Ask about the latest…"}
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:border-foreground/30"
          aria-label="Your question"
        />
        <Button type="submit" size="sm" disabled={busy || !input.trim() || !aiReady} className="h-9">
          Ask
        </Button>
      </form>
    </div>
  )
}

const stamp = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(iso))

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} minutes ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
