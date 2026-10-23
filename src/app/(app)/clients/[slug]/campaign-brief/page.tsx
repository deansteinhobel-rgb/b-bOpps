import { notFound } from "next/navigation"
import { canEdit, getProfile } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { brief as briefSchema, question, type BriefStatus } from "@/lib/campaign-brief/schema"
import { notionWritesLive } from "@/lib/notion/server"
import { peopleForClient } from "@/lib/people"
import { fromJson } from "@/lib/supabase/db"
import { createClient } from "@/lib/supabase/server"
import { BriefGenerator, type BriefRow } from "./brief-generator"

export const metadata = { title: "Generate a campaign brief" }
// The first step (Claude's questions) runs in the background (after()).
export const maxDuration = 300

/**
 * Planning › Generate a campaign brief (Dean, 2026-10-23). Say what the campaign is for ("an MSP
 * campaign"); Claude asks what it needs in a pop-up, then writes the brief from everything Lumaux
 * knows about the client: ad types and quantities per channel, A/B tests, messaging, budget, KPIs.
 * Revise it in words, send it to Master Production as a new page, or download it as Word.
 */
export default async function CampaignBriefPage({ params, searchParams }: PageProps<"/clients/[slug]/campaign-brief">) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, slug, name").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()

  const [{ data: rows }, people] = await Promise.all([
    supabase
      .from("campaign_briefs")
      .select("id, request, notes, status, questions, answers, brief, error, notion_page_url, created_at, updated_at, profiles:created_by(full_name)")
      .eq("client_id", client.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
    peopleForClient(supabase, client.id),
  ])
  const briefs: BriefRow[] = (rows ?? []).map((r) => {
    const b = briefSchema.safeParse(r.brief)
    return {
      id: r.id,
      request: r.request,
      notes: r.notes,
      status: r.status as BriefStatus,
      questions: fromJson<unknown[]>(r.questions, []).flatMap((q) => {
        const x = question.safeParse(q)
        return x.success ? [x.data] : []
      }),
      answers: fromJson<Record<string, string>>(r.answers, {}),
      brief: b.success ? b.data : null,
      error: r.error,
      notionUrl: r.notion_page_url,
      createdAt: r.created_at,
      by: r.profiles?.full_name ?? null,
    }
  })
  const leads = people.filter((p): p is typeof p & { notionUserId: string } => Boolean(p.notionUserId)).map((p) => ({ notionUserId: p.notionUserId, name: p.name, onTeam: p.onTeam }))
  const openId = typeof sp.brief === "string" && briefs.some((b) => b.id === sp.brief) ? sp.brief : null

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Say what the campaign is for and Claude writes the brief from everything Lumaux knows about {client.name}: the client brain, calls, the numbers, past tests and competitor ads. It asks a few questions first. Send the brief to Notion or download it as Word.
      </p>
      <BriefGenerator
        slug={slug}
        clientName={client.name}
        briefs={briefs}
        openId={openId}
        canEdit={canEdit(me)}
        aiReady={aiConfigured()}
        notion={{ leads, defaultLead: me.notion_user_id && leads.some((l) => l.notionUserId === me.notion_user_id) ? me.notion_user_id : null, live: notionWritesLive(client.slug) }}
      />
    </div>
  )
}
