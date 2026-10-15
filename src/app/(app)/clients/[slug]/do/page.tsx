import Link from "next/link"
import { notFound } from "next/navigation"
import { QueueView } from "@/components/queue/queue-view"
import { canEdit, getProfile } from "@/lib/auth"
import { loadQueue } from "@/lib/queue"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "All tasks" }

/** Tasks › All tasks: the Today queue for this client only. */
export default async function ClientToDoPage({ params }: PageProps<"/clients/[slug]/do">) {
  const { slug } = await params
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, slug, name, logo_url").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const items = await loadQueue(supabase, [client], { profileId: me.id }) // client loaded through RLS above

  return (
    <QueueView
      items={items}
      showClient={false}
      canEdit={canEdit(me)}
      empty={`Nothing to act on for ${client.name} right now.`}
      aside={
        <Link href="/today" className="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          All clients on Today →
        </Link>
      }
    />
  )
}
