"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useSyncExternalStore, useTransition } from "react"
import { toast } from "sonner"
import { queueAct } from "@/app/(app)/today/actions"
import { ClientLogo, PlatformIcon } from "@/components/brand"
import { FilterChip, Segmented } from "@/components/segmented"
import { StatusDot } from "@/components/status-badge"
import { Button, buttonVariants } from "@/components/ui/button"
import type { QueueGroup, QueueItem, QueueSource } from "@/lib/queue"
import { cn } from "@/lib/utils"

const GROUPS: { key: QueueGroup; title: string; hint: string }[] = [
  { key: "attention", title: "Needs attention", hint: "Reds, overspend, things promised on calls, tests waiting on a build." },
  { key: "opportunity", title: "Opportunities", hint: "Worth doing: keywords to add, budget-capped winners, ads doing better." },
  { key: "week", title: "This week", hint: "Checks to do and the next step for this sprint's tests." },
  { key: "later", title: "When there's time", hint: "Lower-priority items from Optimise now and next month's checks." },
]
const SOURCES: { value: "all" | QueueSource; label: string }[] = [
  { value: "all", label: "All" },
  { value: "insight", label: "Optimise now" },
  { value: "check", label: "Checks" },
  { value: "test", label: "Sprint" },
  { value: "call", label: "Calls" },
  { value: "pacing", label: "Pacing" },
]
const TONE = { red: "red", amber: "amber", na: "na" } as const
const HIDDEN_KEY = `lumaux:queue-hidden:${new Date().toISOString().slice(0, 10)}`
const HIDDEN_EVENT = "lumaux:queue-hidden"

// "Hide for today" (things with no log of their own, like pacing), kept in this browser only.
const readHidden = () => {
  try {
    return localStorage.getItem(HIDDEN_KEY) ?? "[]"
  } catch {
    return "[]"
  }
}
const onHiddenChange = (cb: () => void) => {
  window.addEventListener("storage", cb)
  window.addEventListener(HIDDEN_EVENT, cb)
  return () => {
    window.removeEventListener("storage", cb)
    window.removeEventListener(HIDDEN_EVENT, cb)
  }
}

/**
 * The Today queue (and a client's "To do"): one row per thing to act on, whatever it came from, with the
 * same layout and buttons everywhere. Done and Snooze use the source's own action; the rest open where
 * the work is done.
 */
export function QueueView({ items, showClient, canEdit, empty }: { items: QueueItem[]; showClient: boolean; canEdit: boolean; empty: string }) {
  const [source, setSource] = useState<"all" | QueueSource>("all")
  const [client, setClient] = useState<string | null>(null)
  // Acted on in this visit (Done, Snooze), plus anything hidden for today.
  const [acted, setActed] = useState<Set<string>>(new Set())
  const stored = useSyncExternalStore(onHiddenChange, readHidden, () => "[]")
  const gone = useMemo(() => {
    let kept: string[] = []
    try {
      kept = JSON.parse(stored) as string[]
    } catch {}
    return new Set([...acted, ...kept])
  }, [acted, stored])
  const [openLater, setOpenLater] = useState(false)
  const hide = (key: string, remember: boolean) => {
    if (!remember) return setActed((g) => new Set(g).add(key))
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...(JSON.parse(readHidden()) as string[]), key]))
      window.dispatchEvent(new Event(HIDDEN_EVENT))
    } catch {
      setActed((g) => new Set(g).add(key))
    }
  }

  const live = useMemo(() => items.filter((i) => !gone.has(i.key)), [items, gone])
  const clients = useMemo(() => [...new Map(live.map((i) => [i.client.slug, i.client])).values()], [live])
  const shown = live.filter((i) => (source === "all" || i.source === source) && (!client || i.client.slug === client))
  const count = (s: "all" | QueueSource) => live.filter((i) => (s === "all" || i.source === s) && (!client || i.client.slug === client)).length

  if (!live.length) return <div className="surface px-6 py-16 text-center text-sm text-muted-foreground">{empty}</div>

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Show" tone="quiet" value={source} onChange={setSource} options={SOURCES.filter((s) => s.value === "all" || count(s.value) > 0).map((s) => ({ ...s, count: count(s.value) }))} />
        {showClient && clients.length > 1 && (
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Client">
            {clients.map((c) => (
              <FilterChip key={c.slug} active={client === c.slug} onClick={() => setClient(client === c.slug ? null : c.slug)}>
                <ClientLogo name={c.name} logoUrl={c.logo_url} size="xs" />
                {c.name}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {GROUPS.map((g) => {
        const rows = shown.filter((i) => i.group === g.key)
        if (!rows.length) return null
        const folded = g.key === "later" && !openLater
        return (
          <section key={g.key} className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  {g.title}
                  <span className="rounded-full bg-secondary px-1.5 text-[11px] leading-5 font-normal text-muted-foreground tabular-nums">{rows.length}</span>
                </h3>
                <p className="text-xs text-muted-foreground">{g.hint}</p>
              </div>
              {g.key === "later" && (
                <Button size="sm" variant="ghost" onClick={() => setOpenLater(!openLater)}>
                  {folded ? "Show" : "Hide"}
                </Button>
              )}
            </div>
            {!folded && (
              <ul className="surface divide-y overflow-hidden">
                {rows.map((i) => (
                  <QueueRow key={i.key} item={i} showClient={showClient} canEdit={canEdit} onGone={hide} />
                ))}
              </ul>
            )}
          </section>
        )
      })}
      {!shown.length && <p className="text-sm text-muted-foreground">Nothing here with these filters.</p>}
    </div>
  )
}

function QueueRow({ item: i, showClient, canEdit, onGone }: { item: QueueItem; showClient: boolean; canEdit: boolean; onGone: (key: string, remember: boolean) => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const act = (action: "done" | "snoozed") =>
    start(async () => {
      if (!i.act) return
      const r = await queueAct(i.act, action)
      if (!r.ok) return void toast.error(r.message ?? "Couldn't save.")
      onGone(i.key, false)
      toast.success(action === "done" ? "Marked done." : "Snoozed for a week.")
      router.refresh()
    })
  return (
    <li className={cn("group flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-secondary/30 sm:flex-nowrap", pending && "opacity-50", i.tone === "lime" && "border-l-2 border-l-lime")}>
      <span className="mt-1.5">{i.tone === "lime" ? <span className="block size-2 rounded-full bg-lime" role="img" aria-label="Opportunity" title="Opportunity" /> : <StatusDot status={TONE[i.tone]} />}</span>
      <div className="min-w-0 flex-1">
        <Link href={i.href} className="flex items-center gap-2 text-sm font-medium hover:underline">
          {i.platform === "ga4" ? <Ga4Icon /> : i.platform ? <PlatformIcon platform={i.platform} /> : null}
          <span className="min-w-0">{i.title}</span>
        </Link>
        {i.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.detail}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-subtle-foreground">
          {showClient && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <ClientLogo name={i.client.name} logoUrl={i.client.logo_url} size="xs" />
              {i.client.name}
            </span>
          )}
          <span>{i.meta}</span>
          {i.when && <span className={cn("rounded-full px-1.5 ring-1", i.when.tone === "red" ? "bg-rag-red-bg text-rag-red ring-rag-red/30" : i.when.tone === "amber" ? "bg-rag-amber-bg text-rag-amber ring-rag-amber/30" : "ring-border")}>{i.when.text}</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:opacity-80 sm:group-hover:opacity-100">
        <Link href={i.href} className={buttonVariants({ size: "sm", variant: "secondary" })}>
          Open
        </Link>
        {canEdit && i.act && (
          <>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("done")}>
              Done
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("snoozed")} title="Hide it for a week">
              Snooze
            </Button>
          </>
        )}
        {i.hideForToday && (
          <Button size="sm" variant="ghost" onClick={() => onGone(i.key, true)} title="Hide it until tomorrow, in this browser">
            Hide today
          </Button>
        )}
      </div>
    </li>
  )
}

function Ga4Icon() {
  return (
    <svg viewBox="0 0 24 24" className="inline-block size-4 shrink-0" aria-hidden>
      <rect x="15" y="3" width="5" height="18" rx="2.5" fill="#F9AB00" />
      <rect x="9" y="9" width="5" height="12" rx="2.5" fill="#E37400" />
      <circle cx="5.5" cy="18.5" r="2.5" fill="#E37400" />
    </svg>
  )
}
