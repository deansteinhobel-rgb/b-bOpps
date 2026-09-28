import Link from "next/link"
import { notFound } from "next/navigation"
import { buildAutoData, type AutoData } from "@/lib/checks/auto-data"
import { londonToday } from "@/lib/checks/periods"
import { ensureCurrentRuns, loadRun, pastRuns } from "@/lib/checks/runs"
import { longDate } from "@/lib/format"
import { addDays } from "@/lib/metrics/ads"
import { cachedOverview } from "@/lib/metrics/cached"
import { notionWritesLive } from "@/lib/notion/server"
import { peopleForClient } from "@/lib/people"
import { previewsFor } from "@/lib/previews"
import { createClient } from "@/lib/supabase/server"
import { CheckCard, type Person } from "./check-card"

export default async function ChecksPage({ params, searchParams }: PageProps<"/clients/[slug]/checks">) {
  const { slug } = await params
  const { run: runParam, result: resultParam } = await searchParams
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()

  // Round 2, all in parallel: runs, the focused result (?result= links from Notion's "QA Document"),
  // cached numbers, people and history.
  const [current, focusResult, overview, { data: team }, { data: profiles }, owners, allPast] = await Promise.all([
    ensureCurrentRuns(supabase, client.id),
    typeof runParam !== "string" && typeof resultParam === "string"
      ? supabase.from("check_results").select("check_run_id").eq("id", resultParam).eq("client_id", client.id).maybeSingle()
      : Promise.resolve({ data: null }),
    cachedOverview(client.id), // access confirmed above (client loaded through RLS)
    supabase.from("client_team").select("profile_id").eq("client_id", client.id).is("removed_at", null),
    supabase.from("profiles").select("id, full_name, email, notion_user_id").not("role", "is", null).order("full_name"),
    peopleForClient(supabase, client.id),
    pastRuns(supabase, client.id, []),
  ])
  const focusRun = typeof runParam === "string" ? runParam : (focusResult.data?.check_run_id ?? null)
  const isCurrent = !focusRun || focusRun === current.weekly.id || focusRun === current.monthly.id
  const runIds = isCurrent ? [current.weekly.id, current.monthly.id] : [focusRun!]
  const history = allPast.filter((h) => h.id !== current.weekly.id && h.id !== current.monthly.id)

  // Round 3: the runs being shown.
  const runs = await Promise.all(runIds.map((id) => loadRun(supabase, id)))
  const actionIds = runs.flatMap((r) => r?.items.map((i) => i.result.notion_action_page_id).filter(Boolean) ?? []) as string[]
  const notionIdByProfile = new Map((profiles ?? []).map((p) => [p.id, p.notion_user_id as string | null]))
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const live = notionWritesLive()
  const defaultDue = addDays(londonToday(), 7)

  // Pre-loaded numbers (live and saved) for every check shown, and the ad previews they mention.
  const liveData = new Map<string, AutoData | null>()
  const keys = new Set<string>()
  for (const loaded of runs) {
    for (const { definition, result } of loaded?.items ?? []) {
      const d = overview ? buildAutoData(definition.key, overview, { currency: client.currency, target, weekStart: loaded!.run.period_start }) : null
      liveData.set(result.id, d)
      for (const k of [...(d?.adKeys ?? []), ...(((result.auto_data as AutoData | null)?.adKeys) ?? [])]) if (k) keys.add(k)
    }
  }
  // Round 4, in parallel: Notion links for actioned reds, and ad previews.
  const [{ data: actionPages }, previews] = await Promise.all([
    actionIds.length
      ? supabase.from("notion_pages_mirror").select("notion_page_id, url").in("notion_page_id", actionIds)
      : Promise.resolve({ data: [] as { notion_page_id: string; url: string }[] }),
    previewsFor(
      supabase,
      client.id,
      [...keys].map((k) => {
        const [platform, external_account_id, ...rest] = k.split("|")
        return { platform, external_account_id, ad_id: rest.join("|") }
      }),
    ),
  ])
  const actionUrl = new Map((actionPages ?? []).map((p) => [p.notion_page_id, p.url]))

  const teamIds = new Set((team ?? []).map((t) => t.profile_id))
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]))
  const people: Person[] = (profiles ?? [])
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email, onTeam: teamIds.has(p.id) }))
    .sort((a, b) => Number(b.onTeam) - Number(a.onTeam) || a.name.localeCompare(b.name))

  return (
    <div className="space-y-12">
      {!isCurrent && (
        <Link href={`/clients/${slug}/checks`} className="text-sm underline">
          ← Back to this week
        </Link>
      )}
      {runs.map((loaded) => {
        if (!loaded) return <p key="missing">That check run wasn&apos;t found.</p>
        const { run, items, done, total } = loaded
        const pct = total ? Math.round((done / total) * 100) : 0
        return (
          <section key={run.id}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">{run.cadence === "weekly" ? "Weekly checks" : "Monthly checks"}</p>
                <h2 className="mt-1 text-2xl">
                  {run.cadence === "weekly"
                    ? `Week of ${longDate(run.period_start)} – ${longDate(run.period_end)}`
                    : new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(run.period_start))}
                </h2>
              </div>
              <p className="text-sm">
                <span className="font-heading text-2xl">{pct}%</span> done · {done} of {total}
              </p>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
              <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-6 space-y-4">
              {items.map(({ definition, result, redNotActioned }) => (
                <CheckCard
                  key={result.id}
                  definition={definition}
                  result={result}
                  redNotActioned={redNotActioned}
                  action={{
                    clientSlug: slug,
                    live,
                    owners: owners.map((p) => ({ id: p.notionUserId, name: p.name, onTeam: p.onTeam })),
                    defaultOwnerNotionId: result.flagged_to_profile_id ? (notionIdByProfile.get(result.flagged_to_profile_id) ?? null) : null,
                    defaultDue,
                    notionUrl: result.notion_action_page_id ? (actionUrl.get(result.notion_action_page_id) ?? null) : null,
                  }}
                  liveData={liveData.get(result.id) ?? null}
                  previews={previews}
                  people={people}
                  checkedByName={result.checked_by_profile_id ? (names.get(result.checked_by_profile_id) ?? null) : null}
                  flaggedToName={result.flagged_to_profile_id ? (names.get(result.flagged_to_profile_id) ?? null) : null}
                />
              ))}
            </div>
          </section>
        )
      })}

      <section>
        <h2 className="text-2xl">Past runs</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No earlier runs yet.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-lg border bg-card">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/clients/${slug}/checks?run=${h.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-secondary/50">
                  <span>
                    {h.cadence === "weekly" ? "Week of" : "Month of"} {longDate(h.period_start)}
                  </span>
                  <span className="text-muted-foreground">
                    {h.done}/{h.total} done{h.reds ? ` · ${h.reds} red` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
