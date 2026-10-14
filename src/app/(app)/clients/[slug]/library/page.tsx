import { notFound } from "next/navigation"
import { canEdit, getProfile } from "@/lib/auth"
import { libraryConfig } from "@/lib/content-library/config"
import { loadLibrary } from "@/lib/content-library/load"
import { createClient } from "@/lib/supabase/server"
import { ContentLibrary } from "./content-library"

export const metadata = { title: "Content library" }

/** Plan › Content library (Dean, 2026-10-14; Camber first): live content and the follow-up emails for each piece. */
export default async function ContentLibraryPage({ params }: PageProps<"/clients/[slug]/library">) {
  const { slug } = await params
  const [supabase, me] = await Promise.all([createClient(), getProfile()])
  const { data: client } = await supabase.from("clients").select("id, slug, name").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const cfg = libraryConfig(client.slug)

  if (!cfg) {
    return (
      <div className="surface px-6 py-10 text-center">
        <p className="font-semibold">No content library for {client.name} yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">The content library is set up per client. Camber has one; ask Dean to add {client.name}.</p>
      </div>
    )
  }

  const pieces = await loadLibrary(supabase, client.id) // client loaded through RLS above

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Every live landing page and guide for {client.name}, and the three emails to send someone who engaged with each one. The Matrix shows which pieces promote each other best.
      </p>
      <ContentLibrary pieces={pieces} verticals={[...cfg.verticals]} clientSlug={client.slug} canEdit={canEdit(me)} />
    </div>
  )
}
