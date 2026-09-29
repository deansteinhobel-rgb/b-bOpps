import { notFound } from "next/navigation"
import { getProfile, isAdmin } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { createClient } from "@/lib/supabase/server"
import { BrainView, type Brief, type Knowledge } from "./brain-view"

export const metadata = { title: "Client brain" }

// A rebuild still "generating" after 10 minutes has died; don't show it as running.
const startedRecently = (iso: string) => Date.now() - Date.parse(iso) < 10 * 60_000

/** The Client brain: the client's Notion HQ, team must-knows and files, condensed into a brief. */
export default async function BrainPage({ params }: PageProps<"/clients/[slug]/brain">) {
  const { slug } = await params
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, name, notion_hq_page_id").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const [{ data: briefs }, { data: knowledge }] = await Promise.all([
    supabase.from("client_briefs").select("id, status, content, written_by, source_count, error, created_at, finished_at, profiles:created_by_profile_id(full_name)").eq("client_id", client.id).order("created_at", { ascending: false }).limit(10),
    supabase
      .from("client_knowledge")
      .select("id, source, notion_page_id, notion_kind, path, include, category, file_type, title, content_chars, synced_at, error, created_at")
      .eq("client_id", client.id)
      .is("removed_at", null)
      .order("created_at"),
  ])
  const all = (briefs ?? []) as unknown as (Brief & { status: string; error: string | null })[]
  return (
    <BrainView
      slug={slug}
      clientName={client.name}
      hqPageId={client.notion_hq_page_id}
      canAdmin={isAdmin(me)}
      aiReady={aiConfigured()}
      brief={all.find((b) => b.status === "ready") ?? null}
      generating={all.find((b) => b.status === "generating" && startedRecently(b.created_at))?.id ?? null}
      lastFailed={all[0]?.status === "failed" ? (all[0].error ?? "Something went wrong.") : null}
      knowledge={(knowledge ?? []) as Knowledge[]}
    />
  )
}
