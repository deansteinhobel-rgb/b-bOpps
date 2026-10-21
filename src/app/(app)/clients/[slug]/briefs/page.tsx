import { ChevronRight, CornerDownRight } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { NotionSyncBar } from "@/components/notion-sync-bar"
import { SectionHeader } from "@/components/page-header"
import { londonToday } from "@/lib/checks/periods"
import { byDue, lastNotionSync, minutesAgo, mirrorItems, type MirrorItem } from "@/lib/notion/mirror"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

/** Master Status values grouped into stages (the board's own groups don't separate them). */
const STAGES = [
  { key: "production", label: "In production", tone: "lime", statuses: ["Production"] },
  { key: "client", label: "With the client", tone: "violet", statuses: ["Client Approval", "Awaiting Client Copy", "Client Amends"] },
  { key: "approved", label: "Approved, ready to launch", tone: "green", statuses: ["Client Approved"] },
  { key: "todo", label: "Not started", tone: "muted", statuses: ["New", "Ideation/Strategy", "Awaiting Brief Approval", "Parking Lot", "Parent - Open for More"] },
  { key: "hold", label: "On hold", tone: "amber", statuses: ["Paused", "Stuck"] },
  { key: "done", label: "Done", tone: "muted", statuses: ["Production Complete", "Cancelled", "Archive"] },
] as const
type Tone = (typeof STAGES)[number]["tone"]
// A stage is a small dot beside its name (summary strip, group headings); statuses in rows are
// outlined neutral chips, since the group heading already says the stage (taste sweep).
const DOT: Record<Tone, string> = {
  lime: "bg-foreground",
  violet: "bg-pink",
  green: "bg-rag-green",
  amber: "bg-rag-amber",
  muted: "bg-rag-na",
}
const stageOf = (status: string | null) => STAGES.find((s) => (s.statuses as readonly string[]).includes(status ?? "")) ?? STAGES[3]

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
function dueLabel(due: string | null, today: string, closed: boolean) {
  if (!due) return { text: "No date", tone: "text-subtle-foreground" }
  const d = dayDiff(today, due)
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(due))
  if (closed) return { text: date, tone: "text-muted-foreground" }
  if (d < 0) return { text: `${date} · ${-d}d overdue`, tone: "text-rag-red" }
  if (d === 0) return { text: `${date} · today`, tone: "text-rag-amber" }
  if (d <= 3) return { text: `${date} · in ${d}d`, tone: "text-rag-amber" }
  return { text: date, tone: "text-muted-foreground" }
}

export default async function BriefsPage({ params, searchParams }: PageProps<"/clients/[slug]/briefs">) {
  const { slug } = await params
  const { all, done } = await searchParams
  const showAll = all === "1"
  const showDone = done === "1"
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) notFound()

  const [briefs, synced] = await Promise.all([mirrorItems(supabase, client.id, "brief"), lastNotionSync(supabase)])
  const today = londonToday()
  // Paid media only by default: matching rows, plus sub-items whose parent matches.
  const paidIds = new Set(briefs.filter((b) => b.paid).map((b) => b.id))
  const inScope = showAll ? briefs : briefs.filter((b) => b.paid || (b.parentId !== null && paidIds.has(b.parentId)))
  const ids = new Set(inScope.map((b) => b.id))
  const children = new Map<string, MirrorItem[]>()
  for (const b of inScope) if (b.parentId && ids.has(b.parentId)) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b])
  const top = inScope.filter((b) => !b.parentId || !ids.has(b.parentId))
  const groups = STAGES.map((s) => ({ ...s, items: top.filter((b) => stageOf(b.status).key === s.key).sort(byDue) })).filter((g) => g.items.length && (showDone || g.key !== "done"))
  const doneCount = top.filter((b) => stageOf(b.status).key === "done").length
  const overdue = top.filter((b) => !b.closed && b.due && b.due < today).length
  const hiddenOpen = briefs.filter((b) => !b.closed).length - inScope.filter((b) => !b.closed).length
  const href = (o: { all?: boolean; done?: boolean }) => {
    const q = new URLSearchParams()
    if (o.all ?? showAll) q.set("all", "1")
    if (o.done ?? showDone) q.set("done", "1")
    return `/clients/${slug}/briefs${q.size ? `?${q}` : ""}`
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Briefs"
        description={showAll ? "Every brief from Master Production (read-only)." : "Paid media briefs from Master Production (read-only)."}
        actions={<NotionSyncBar clientSlug={slug} syncedLabel={minutesAgo(synced)} />}
      />

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {STAGES.filter((s) => s.key !== "done").map((s) => {
          const n = top.filter((b) => stageOf(b.status).key === s.key).length
          return (
            <span key={s.key} className={cn("inline-flex items-center gap-1.5 text-xs", n ? "text-body" : "text-subtle-foreground")}>
              <span className={cn("size-1.5 rounded-full", n ? DOT[s.tone] : "bg-border")} aria-hidden />
              {s.label}
              <span className={cn("tabular-nums", n && "font-medium text-foreground")}>{n}</span>
            </span>
          )
        })}
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-rag-red">
            <span className="size-1.5 rounded-full bg-rag-red" aria-hidden />
            <span className="tabular-nums">{overdue}</span> overdue
          </span>
        )}
        <span className="ml-auto flex gap-3 text-xs">
          <Link href={href({ all: !showAll })} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {showAll ? "Paid media only" : `Show all briefs (+${hiddenOpen})`}
          </Link>
          <Link href={href({ done: !showDone })} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {showDone ? "Hide done" : `Show done (${doneCount})`}
          </Link>
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="surface px-6 py-16 text-center text-sm text-muted-foreground">No open briefs.</div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <span className={cn("size-2 rounded-full", DOT[g.tone])} aria-hidden />
                {g.label}
                <span className="font-normal text-subtle-foreground tabular-nums">{g.items.length}</span>
              </h3>
              <ul className="surface divide-y overflow-hidden">
                {g.items.map((b) => (
                  <BriefRow key={b.id} b={b} kids={(children.get(b.id) ?? []).sort(byDue)} today={today} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Avatars({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-xs text-subtle-foreground">No lead</span>
  return (
    <span className="flex items-center" title={names.join(", ")}>
      {names.slice(0, 3).map((n, i) => (
        <span key={n + i} className={cn("flex size-6 items-center justify-center rounded-full bg-elevated text-[11px] font-medium ring-2 ring-card", i > 0 && "-ml-1.5")}>
          {n
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </span>
      ))}
      {names.length > 3 && <span className="ml-1 text-[11px] text-muted-foreground">+{names.length - 3}</span>}
    </span>
  )
}

function StatusPill({ status }: { status: string | null }) {
  return <span className="inline-flex max-w-full items-center justify-self-start truncate rounded-full border border-border-strong px-2 py-0.5 text-[11px] text-body">{status ?? "No status"}</span>
}

function Line({ b, today, nested }: { b: MirrorItem; today: string; nested?: boolean }) {
  const due = dueLabel(b.due, today, b.closed)
  return (
    <div className={cn("grid items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_9.5rem_5.5rem_9rem_4.5rem]", nested && "bg-background/40 pl-10 md:pl-12")}>
      <div className="min-w-0">
        <p className={cn("truncate text-sm", nested ? "text-muted-foreground" : "font-medium")} title={b.title}>
          {nested && <CornerDownRight className="mr-1.5 inline size-3.5 align-[-2px] text-subtle-foreground" aria-hidden />}
          {b.title}
        </p>
        {!nested && (b.productionType || b.priority) && (
          <p className="mt-1 flex flex-wrap gap-1.5">
            {b.productionType && <span className="rounded-full border border-border-strong px-2 py-px text-[11px] text-body">{b.productionType}</span>}
            {b.priority === "High" && <span className="rounded-full border border-border-strong px-2 py-px text-[11px] text-rag-red">High priority</span>}
          </p>
        )}
      </div>
      <StatusPill status={b.status} />
      <Avatars names={b.owners} />
      <span className={cn("text-xs tabular-nums", due.tone)}>{due.text}</span>
      <a href={b.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:text-right">
        Notion ↗
      </a>
    </div>
  )
}

function BriefRow({ b, kids, today }: { b: MirrorItem; kids: MirrorItem[]; today: string }) {
  if (!kids.length) {
    return (
      <li>
        <Line b={b} today={today} />
      </li>
    )
  }
  const openKids = kids.filter((k) => !k.closed).length
  return (
    <li>
      <details className="group">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <div className="relative hover:bg-white/[0.03]">
            <Line b={b} today={today} />
            <span className="absolute bottom-1 left-4 text-[11px] text-subtle-foreground group-open:hidden">
              {kids.length} sub-item{kids.length === 1 ? "" : "s"}
              {openKids ? ` · ${openKids} open` : ""}
              <ChevronRight className="ml-0.5 inline size-3 align-[-2px]" aria-hidden />
            </span>
          </div>
        </summary>
        <div className="divide-y border-t">
          {kids.map((k) => (
            <Line key={k.id} b={k} today={today} nested />
          ))}
        </div>
      </details>
    </li>
  )
}
