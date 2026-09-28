import Link from "next/link"
import { notFound } from "next/navigation"
import { NotionSyncBar } from "@/components/notion-sync-bar"
import { longDate } from "@/lib/format"
import { byDue, lastNotionSync, minutesAgo, mirrorItems, type MirrorItem } from "@/lib/notion/mirror"
import { createClient } from "@/lib/supabase/server"

export default async function BriefsPage({ params, searchParams }: PageProps<"/clients/[slug]/briefs">) {
  const { slug } = await params
  const { completed, all } = await searchParams
  const showCompleted = completed === "1"
  const showAll = all === "1"
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) notFound()

  const [briefs, synced] = await Promise.all([mirrorItems(supabase, client.id, "brief"), lastNotionSync(supabase)])
  // Paid media only by default: matching rows, plus sub-items whose parent matches.
  const paidIds = new Set(briefs.filter((b) => b.paid).map((b) => b.id))
  const inScope = showAll ? briefs : briefs.filter((b) => b.paid || (b.parentId !== null && paidIds.has(b.parentId)))
  const visible = inScope.filter((b) => showCompleted || !b.closed)
  const ids = new Set(visible.map((b) => b.id))
  const children = new Map<string, MirrorItem[]>()
  for (const b of visible) if (b.parentId && ids.has(b.parentId)) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b])
  const top = visible.filter((b) => !b.parentId || !ids.has(b.parentId)).sort(byDue)
  const completedCount = inScope.filter((b) => b.closed).length
  const hiddenCount = briefs.filter((b) => !b.closed).length - inScope.filter((b) => !b.closed).length
  const link = (o: { completed?: boolean; all?: boolean }) => {
    const q = new URLSearchParams()
    if (o.completed ?? showCompleted) q.set("completed", "1")
    if (o.all ?? showAll) q.set("all", "1")
    return `/clients/${slug}/briefs${q.size ? `?${q}` : ""}`
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl">Briefs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {showAll ? "All briefs" : "Paid media briefs"} from the Master Production board (read-only). Sub-items sit under their parent.
          </p>
        </div>
        <NotionSyncBar clientSlug={slug} syncedLabel={minutesAgo(synced)} />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href={link({ all: !showAll })} className="underline">
          {showAll ? "Paid media only" : `Show all briefs (${hiddenCount} more open)`}
        </Link>
        <Link href={link({ completed: !showCompleted })} className="underline">
          {showCompleted ? "Hide Production Complete" : `Show Production Complete (${completedCount})`}
        </Link>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open briefs.</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {top.map((b) => (
            <li key={b.id}>
              <BriefRow b={b} />
              {(children.get(b.id) ?? []).sort(byDue).map((c) => (
                <BriefRow key={c.id} b={c} nested />
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BriefRow({ b, nested }: { b: MirrorItem; nested?: boolean }) {
  return (
    <div className={`grid gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_9rem_10rem_8rem_7rem] sm:items-center sm:gap-4 ${nested ? "border-t border-dashed pl-10" : ""}`}>
      <div>
        <p className={nested ? "" : "font-bold"}>
          {nested && <span className="mr-1 text-muted-foreground">↳</span>}
          {b.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {[b.productionType, b.priority && `${b.priority} priority`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <span>{b.status ?? "–"}</span>
      <span className="truncate" title={b.owners.join(", ")}>
        {b.owners.join(", ") || "–"}
      </span>
      <span>{b.due ? longDate(b.due) : "No date"}</span>
      <a href={b.url} target="_blank" rel="noreferrer" className="underline sm:text-right">
        Open in Notion
      </a>
    </div>
  )
}
