import Link from "next/link"
import { notFound } from "next/navigation"
import { ActionForm } from "@/components/action-form"
import { NotionSyncBar } from "@/components/notion-sync-bar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { londonToday } from "@/lib/checks/periods"
import { longDate } from "@/lib/format"
import { addDays } from "@/lib/metrics/ads"
import { byDue, lastNotionSync, minutesAgo, mirrorItems } from "@/lib/notion/mirror"
import { notionWritesLive } from "@/lib/notion/server"
import { peopleForClient } from "@/lib/people"
import { createClient } from "@/lib/supabase/server"

export default async function ActionsPage({ params, searchParams }: PageProps<"/clients/[slug]/actions">) {
  const { slug } = await params
  const { closed } = await searchParams
  const showClosed = closed === "1"
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, name").eq("slug", slug).maybeSingle()
  if (!client) notFound()

  const [actions, synced, people, { data: log }] = await Promise.all([
    mirrorItems(supabase, client.id, "action"),
    lastNotionSync(supabase),
    peopleForClient(supabase, client.id),
    supabase
      .from("notion_write_log")
      .select("id, created_at, dry_run, success, payload, response, profiles(full_name, email)")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ])
  const visible = actions.filter((a) => showClosed || !a.closed).sort(byDue)
  const live = notionWritesLive()

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl">Actions</h2>
            <p className="mt-1 text-sm text-muted-foreground">Actions created from this app on the Master Production board. Status and edits happen in Notion.</p>
          </div>
          <NotionSyncBar clientSlug={slug} syncedLabel={minutesAgo(synced)} />
        </div>
        <div className="mt-3 text-sm">
          <Link href={showClosed ? `/clients/${slug}/actions` : `/clients/${slug}/actions?closed=1`} className="underline">
            {showClosed ? "Hide completed" : `Show completed (${actions.filter((a) => a.closed).length})`}
          </Link>
        </div>
        {visible.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No {showClosed ? "" : "open "}actions yet.</p>
        ) : (
          <Table className="mt-4 rounded-lg bg-card">
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Due</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="max-w-96 font-bold">{a.title}</TableCell>
                  <TableCell>{a.status ?? "–"}</TableCell>
                  <TableCell>{a.owners.join(", ") || "–"}</TableCell>
                  <TableCell>{a.due ? longDate(a.due) : "–"}</TableCell>
                  <TableCell className="text-right">
                    <a href={a.url} target="_blank" rel="noreferrer" className="underline">
                      Open in Notion
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section>
        <h2 className="text-2xl">New action</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates a row on Master Production for {client.name}: Production Type &ldquo;Paid Media&rdquo;, status &ldquo;New&rdquo;.
        </p>
        <div className="mt-4 max-w-2xl">
          <ActionForm
            clientSlug={slug}
            live={live}
            owners={people.map((p) => ({ id: p.notionUserId, name: p.name, onTeam: p.onTeam }))}
            defaults={{ title: "", ownerId: null, dueDate: addDays(londonToday(), 7), description: "" }}
          />
        </div>
      </section>

      <section>
        <h2 className="text-2xl">Write log</h2>
        <p className="mt-1 text-sm text-muted-foreground">Every Notion write this app has made or tested for {client.name}, newest first.</p>
        {!log?.length ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-lg border bg-card text-sm">
            {log.map((l) => {
              const title = ((l.payload as { properties?: { Project?: { title?: { text: { content: string } }[] } } }).properties?.Project?.title ?? []).map((t) => t.text.content).join("")
              const who = l.profiles as unknown as { full_name: string | null; email: string } | null
              const url = (l.response as { url?: string } | null)?.url
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span>
                    <strong>{title || "(untitled)"}</strong> · {who?.full_name ?? who?.email} · {new Date(l.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  <span className={l.success === false ? "text-rag-red" : "text-muted-foreground"}>
                    {l.dry_run ? "Test only, not sent" : l.success ? (url ? <a href={url} target="_blank" rel="noreferrer" className="underline">Created</a> : "Created") : "Failed"}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
