import { notFound } from "next/navigation"
import { canEdit, getProfile, isAdmin } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { followUpsForClient } from "@/lib/calls/load"
import { createClient } from "@/lib/supabase/server"
import { BrainView, type Brief, type Knowledge } from "./brain-view"
import { CallsPanel, type Call } from "./calls-panel"

export const metadata = { title: "Client brain" }

// A rebuild still "generating" after 10 minutes has died; don't show it as running.
const startedRecently = (iso: string) => Date.now() - Date.parse(iso) < 10 * 60_000
// HQ pages that look like where call notes live, offered when linking them.
const CALLISH = /call|meeting|sync|catch.?up|minutes/i
const norm = (id: string | null) => (id ?? "").replace(/-/g, "")

/** The Client brain: the client's Notion HQ, call notes, team must-knows and files, condensed into a brief. */
export default async function BrainPage({ params }: PageProps<"/clients/[slug]/brain">) {
  const { slug } = await params
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, name, notion_hq_page_id, call_notes_notion_id, call_notes_kind, call_notes_client_option, call_notes_title, call_notes_checked_at").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const [{ data: briefs }, { data: knowledge }, { data: calls }, followUps] = await Promise.all([
    supabase.from("client_briefs").select("id, status, content, written_by, source_count, error, created_at, finished_at, profiles:created_by_profile_id(full_name)").eq("client_id", client.id).order("created_at", { ascending: false }).limit(10),
    supabase
      .from("client_knowledge")
      .select("id, source, notion_page_id, notion_kind, path, include, category, file_type, title, content_chars, synced_at, error, created_at")
      .eq("client_id", client.id)
      .is("removed_at", null)
      .order("created_at"),
    supabase.from("client_calls").select("id, source, notion_page_id, title, call_date, notion_status, summary, extract_status, extract_error, content_chars").eq("client_id", client.id).is("removed_at", null).order("call_date", { ascending: false }).limit(300),
    followUpsForClient(supabase, client.id),
  ])
  const all = (briefs ?? []) as unknown as (Brief & { status: string; error: string | null })[]
  const pages = (knowledge ?? []) as Knowledge[]
  const hq = pages.filter((k) => k.source === "notion")
  const sourceTitle = client.call_notes_notion_id ? (hq.find((k) => norm(k.notion_page_id) === norm(client.call_notes_notion_id))?.title ?? client.call_notes_title) : null
  return (
    <div className="space-y-12">
      <BrainView
        slug={slug}
        clientName={client.name}
        hqPageId={client.notion_hq_page_id}
        canAdmin={isAdmin(me)}
        aiReady={aiConfigured()}
        brief={all.find((b) => b.status === "ready") ?? null}
        generating={all.find((b) => b.status === "generating" && startedRecently(b.created_at))?.id ?? null}
        lastFailed={all[0]?.status === "failed" ? (all[0].error ?? "Something went wrong.") : null}
        knowledge={pages}
      />
      <CallsPanel
        slug={slug}
        clientName={client.name}
        source={client.call_notes_notion_id ? { id: client.call_notes_notion_id, kind: client.call_notes_kind as "page" | "database", clientOption: client.call_notes_client_option, checkedAt: client.call_notes_checked_at } : null}
        sourceTitle={sourceTitle}
        suggestions={hq.filter((k) => CALLISH.test(k.title) && norm(k.notion_page_id) !== norm(client.call_notes_notion_id)).slice(0, 6).map((k) => ({ id: k.notion_page_id!, title: k.title, path: k.path }))}
        calls={(calls ?? []) as Call[]}
        followUps={followUps}
        canAdmin={isAdmin(me)}
        canEdit={canEdit(me)}
        aiReady={aiConfigured()}
      />
    </div>
  )
}
