"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { Button } from "@/components/ui/button"
import { CAMPAIGN_STARTERS, WEEKLY_READ } from "@/lib/insights/campaign-starters"
import { cn } from "@/lib/utils"

type Msg = { role: "user" | "assistant"; content: string; sources?: { url: string; title: string }[]; error?: boolean; cachedAt?: string }

/**
 * "Ask about this campaign" (performance phase 4): Claude reads this campaign's weekly numbers, ads,
 * search terms or audiences, open insights, goal and the client brief, and answers. The weekly read
 * is shared by the team for the week; other questions aren't stored.
 */
export function CampaignAsk({ slug, platform, campaignId, aiReady }: { slug: string; platform: string; campaignId: string; aiReady: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (msgs.length) end.current?.scrollIntoView({ block: "nearest" })
  }, [msgs, status])

  const ask = async (q: string, fresh = false) => {
    const question = q.trim()
    if (!question || busy) return
    const history: Msg[] = [...(fresh ? [] : msgs.filter((m) => !m.error)), { role: "user", content: question }]
    setMsgs([...history, { role: "assistant", content: "" }])
    setInput("")
    setBusy(true)
    setStatus("Reading the campaign…")
    const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), fn(all[all.length - 1])])
    try {
      const res = await fetch("/api/campaign-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientSlug: slug, platform, campaignId, fresh, messages: history.map(({ role, content }) => ({ role, content })) }),
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

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5 text-lime" aria-hidden>
              <path d="M8 0.8c.5 3.6 1.9 5.9 7.2 7.2-5.3 1.3-6.7 3.6-7.2 7.2-.5-3.6-1.9-5.9-7.2-7.2C6.1 6.7 7.5 4.4 8 .8Z" />
            </svg>
            Ask about this campaign
          </h3>
          <p className="text-xs text-muted-foreground">Claude reads 12 weeks of numbers, the ads, the detail below, open insights, the campaign&apos;s goal and the client brief.</p>
        </div>
        {msgs.length > 0 && !busy && (
          <Button size="sm" variant="ghost" onClick={() => setMsgs([])}>
            Start over
          </Button>
        )}
      </div>

      <div className="space-y-4 px-5 py-4 text-sm">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {CAMPAIGN_STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!aiReady}
                onClick={() => ask(s)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50",
                  s === WEEKLY_READ ? "border-lime/40 bg-lime/10 text-foreground hover:bg-lime/15" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="ml-auto w-fit max-w-[85%] rounded-lg bg-accent px-3 py-2">
              {m.content}
            </p>
          ) : (
            <div key={i} className={cn("max-w-3xl space-y-2", m.error && "text-rag-red")}>
              {m.content && (
                <div className="space-y-2 leading-relaxed [&_a]:underline [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc">
                  <ReactMarkdown components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{m.content}</ReactMarkdown>
                </div>
              )}
              {m.cachedAt && (
                <p className="text-[11px] text-muted-foreground">
                  This week&apos;s read, shared with the team (written {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(m.cachedAt))}).{" "}
                  {i === 1 && !busy && (
                    <button type="button" onClick={() => ask(msgs[0].content, true)} className="underline hover:text-foreground">
                      Get a fresh read
                    </button>
                  )}
                </p>
              )}
              {m.sources && m.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {m.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="max-w-full truncate rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground" title={s.title}>
                      {host(s.url)}
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
          placeholder={aiReady ? "Ask anything about this campaign…" : "Add ANTHROPIC_API_KEY to switch this on"}
          disabled={!aiReady}
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:border-foreground/30"
          aria-label="Your question"
        />
        <Button type="submit" size="sm" disabled={busy || !input.trim() || !aiReady} className="h-9">
          Ask
        </Button>
      </form>
    </section>
  )
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
