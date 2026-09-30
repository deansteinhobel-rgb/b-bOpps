import Link from "next/link"
import { notFound } from "next/navigation"
import { QueueView } from "@/components/queue/queue-view"
import { canEdit, getProfile } from "@/lib/auth"
import { loadQueue } from "@/lib/queue"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "To do" }

/** Do › To do (new layout): the Today queue for this client only. */
export default async function ClientToDoPage({ params }: PageProps<"/clients/[slug]/do">) {
  const { slug } = await params
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, slug, name, logo_url").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const items = await loadQueue(supabase, [client], { profileId: me.id }) // client loaded through RLS above

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Everything to act on for {client.name}, ranked. The same list across all your clients is on <Link href="/today" className="underline hover:text-foreground">Today</Link>.
      </p>
      <QueueView items={items} showClient={false} canEdit={canEdit(me)} empty={`Nothing to act on for ${client.name} right now.`} />
    </div>
  )
}
