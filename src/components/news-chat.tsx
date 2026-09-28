"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { X } from "lucide-react"
import { WinePour } from "@/components/fx/wine-pour"
import { Button } from "@/components/ui/button"
import { NEWS_STARTERS as STARTERS } from "@/lib/ai/news-starters"
import { cn } from "@/lib/utils"

type Msg = { role: "user" | "assistant"; content: string; sources?: { url: string; title: string }[]; error?: boolean; cachedAt?: string }

/**
 * "The news cellar": a floating chat for the latest paid media news (Google, Bing, LinkedIn, Meta,
 * Reddit, ChatGPT Ads, X). Claude searches the web and cites sources. Nothing is stored; no client
 * data is sent.
 */
export function NewsChat() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [msgs, status])

  // `fresh` skips the shared 7-day answer for a suggested question (starts the chat over).
  const ask = async (q: string, fresh = false) => {
    const question = q.trim()
    if (!question || busy) return
    const history: Msg[] = [...(fresh ? [] : msgs.filter((m) => !m.error)), { role: "user", content: question }]
    setMsgs([...history, { role: "assistant", content: "" }])
    setInput("")
    setBusy(true)
    setStatus("Uncorking the news…")
    const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), fn(all[all.length - 1])])
    try {
      const res = await fetch("/api/news-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fresh, messages: history.map(({ role, content }) => ({ role, content })) }) })
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
            patch((m) => ({ ...m, content: m.content + (ev.text ?? "") }))
          }
          if (ev.type === "sources") patch((m) => ({ ...m, sources: ev.sources }))
          if (ev.type === "cached") patch((m) => ({ ...m, cachedAt: ev.at }))
          if (ev.type === "error") patch((m) => ({ ...m, content: ev.text ?? "Something went wrong.", error: true }))
        }
      }
    } catch (e) {
      patch((m) => ({ ...m, content: (e as Error).message || "Something went wrong.", error: true }))
    }
    setBusy(false)
    setStatus(null)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border border-lime/30 bg-card py-2 pr-4 pl-2 text-sm shadow-lg shadow-black/40 transition-colors hover:border-lime/60"
        aria-label="Open the paid media news chat"
      >
        <WinePour progress={0.7} pouring={false} className="h-8 w-7 text-foreground" />
        What&apos;s new in paid media?
      </button>
    )
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 flex h-[min(620px,calc(100dvh-2rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/50" role="dialog" aria-label="Paid media news">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="font-heading text-lg leading-tight">The news cellar</p>
          <p className="text-[11px] text-muted-foreground">Google · Bing · LinkedIn · Meta · Reddit · ChatGPT Ads · X, fresh from the web</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {msgs.length === 0 && (
          <div className="space-y-3">
            <p className="text-muted-foreground">Ask about new campaign types, bidding, targeting or features on any platform. I&apos;ll search and cite sources.</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border px-3 py-1.5 text-left text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="ml-8 rounded-lg bg-accent px-3 py-2">
              {m.content}
            </p>
          ) : (
            <div key={i} className={cn("space-y-2", m.error && "text-rag-red")}>
              {m.content && (
                <div className="space-y-2 leading-relaxed [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc">
                  <ReactMarkdown components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{m.content}</ReactMarkdown>
                </div>
              )}
              {m.cachedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Shared answer from {ago(m.cachedAt)}, kept for 7 days to save tokens.{" "}
                  {i === 1 && !busy && (
                    <button type="button" onClick={() => ask(msgs[0].content, true)} className="underline hover:text-foreground">
                      Get a fresh answer
                    </button>
                  )}
                </p>
              )}
              {m.sources && m.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {m.sources.map((s) => (
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
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about the latest…" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:border-foreground/30" aria-label="Your question" />
        <Button type="submit" size="sm" disabled={busy || !input.trim()} className="h-9">
          Ask
        </Button>
      </form>
    </div>
  )
}

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
