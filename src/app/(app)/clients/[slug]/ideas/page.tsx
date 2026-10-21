import { notFound } from "next/navigation"
import { londonToday } from "@/lib/checks/periods"
import { createClient } from "@/lib/supabase/server"
import { ContentIdeas } from "../_glance/content-ideas"
import { loadContentIdeas } from "../_glance/content-ideas-data"

export const metadata = { title: "Content ideas" }

/** Plan › Content ideas (new layout): the panel that sits on At a glance in the classic layout. */
export default async function ContentIdeasPage({ params }: PageProps<"/clients/[slug]/ideas">) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, name, currency").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const ideas = await loadContentIdeas(supabase, client, londonToday()) // client loaded through RLS above

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Which content is working for {client.name} and for whom, and Claude&apos;s ideas for content, ads and angles to brief in or test, each matched to the audience it&apos;s for. Plan one as a sprint test, or say why it isn&apos;t for us.
      </p>
      <ContentIdeas slug={slug} currency={client.currency} {...ideas} />
    </div>
  )
}
