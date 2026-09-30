import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { shortDate } from "@/lib/format"
import { addDays } from "@/lib/metrics/ads"
import { peopleForClient } from "@/lib/people"
import { sprintOf } from "@/lib/sprints/periods"
import type { IdeaRun, IdeaState } from "./content-ideas"

/**
 * Everything the Content ideas panel needs: the latest finished run, one in progress, what the team did
 * with each idea, and who can own a test. Used by At a glance (classic layout) and Plan › Content ideas.
 * Call after the client was loaded through RLS.
 */
export async function loadContentIdeas(supabase: SupabaseClient, client: { id: string; slug: string }, today: string) {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString()
  const [{ data: ideaRun }, { data: ideaRunning }, { data: canEditClient }, people] = await Promise.all([
    supabase.from("content_idea_runs").select("id, headline, working, ideas, avoid, finished_at, requested_by_profile_id").eq("client_id", client.id).eq("status", "ready").is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("content_idea_runs").select("id, progress").eq("client_id", client.id).eq("status", "generating").gte("created_at", tenMinutesAgo).limit(1).maybeSingle(),
    supabase.rpc("can_edit_client", { cid: client.id }),
    peopleForClient(supabase, client.id),
  ])
  const { data: ideaActions } = ideaRun ? await supabase.from("content_idea_actions").select("idea_id, action, reason, sprint_test_id, created_at").eq("run_id", ideaRun.id).order("created_at") : { data: [] }
  const states: Record<string, IdeaState> = {}
  for (const a of ideaActions ?? []) {
    if (a.action === "reopened") delete states[a.idea_id]
    else states[a.idea_id] = { action: a.action as IdeaState["action"], reason: a.reason, testUrl: a.sprint_test_id ? `/clients/${client.slug}/sprint#test-${a.sprint_test_id}` : null }
  }
  const by = ideaRun?.requested_by_profile_id ? people.find((p) => p.profileId === ideaRun.requested_by_profile_id)?.name : null
  const run: IdeaRun | null = ideaRun
    ? { id: ideaRun.id, headline: ideaRun.headline, working: ideaRun.working as IdeaRun["working"], ideas: ideaRun.ideas as IdeaRun["ideas"], avoid: ideaRun.avoid as IdeaRun["avoid"], when: `${shortDate((ideaRun.finished_at ?? today).slice(0, 10))}${by ? ` for ${by}` : ""}` }
    : null
  return {
    run,
    running: ideaRunning ? { id: ideaRunning.id as string, progress: ideaRunning.progress as string | null } : null,
    states,
    owners: people.filter((p) => p.notionUserId && p.onTeam).map((p) => ({ notionUserId: p.notionUserId!, name: p.name })),
    canRun: Boolean(canEditClient),
    canEdit: Boolean(canEditClient),
    deadline: [addDays(today, 7), sprintOf(today).end].sort()[0],
  }
}
