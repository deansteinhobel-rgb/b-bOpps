import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { QueueView } from "@/components/queue/queue-view"
import { canEdit, getProfile, isAdmin } from "@/lib/auth"
import { loadQueue, type QueueClient } from "@/lib/queue"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

export const metadata = { title: "Today" }

/**
 * Today (new layout, Dean 2026-09-30): everything to act on across the clients you work on, in one
 * ranked list. Spans clients (Dean approved), but every client comes through RLS first, so it only
 * ever shows clients you can already open. Admins can switch to all clients; viewers see all, read only.
 */
export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  const me = await getProfile()
  const { all } = await searchParams
  const supabase = await createClient()
  const [{ data: clients }, { data: team }] = await Promise.all([
    supabase.from("clients").select("id, slug, name, logo_url").eq("active", true).order("name"),
    supabase.from("client_team").select("client_id").eq("profile_id", me.id).is("removed_at", null),
  ])
  const mine = new Set((team ?? []).map((t) => t.client_id))
  const onTeam = mine.size > 0
  const showAll = !onTeam || (isAdmin(me) && all === "1")
  const list = ((clients ?? []) as QueueClient[]).filter((c) => showAll || mine.has(c.id))
  const items = await loadQueue(supabase, list, { profileId: me.id })
  const first = (me.full_name ?? "").split(" ")[0]
  const attention = items.filter((i) => i.group === "attention").length
  const clientCount = new Set(items.map((i) => i.client.slug)).size

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={showAll ? "All clients" : "Your clients"}
        title={first ? `Today, ${first}` : "Today"}
        description={
          items.length
            ? `${items.length} thing${items.length === 1 ? "" : "s"} to act on across ${clientCount} client${clientCount === 1 ? "" : "s"}${attention ? `, ${attention} needing attention` : ""}. From Optimise now, checks, calls, the sprint and pacing.`
            : "Everything to act on across your clients: Optimise now, checks, calls, the sprint and pacing."
        }
        actions={
          isAdmin(me) &&
          onTeam && (
            <div className="flex rounded-full border bg-card p-0.5 text-sm">
              {[
                ["/today", "My clients", !showAll],
                ["/today?all=1", "All clients", showAll],
              ].map(([href, label, active]) => (
                <Link key={String(href)} href={String(href)} className={cn("rounded-full px-3 py-1 transition-colors", active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {label}
                </Link>
              ))}
            </div>
          )
        }
      />
      <QueueView items={items} showClient canEdit={canEdit(me)} empty="Nothing to act on right now. Checks, insights, call follow-ups and tests will show up here when they need you." />
    </div>
  )
}
