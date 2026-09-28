import Link from "next/link"
import { notFound } from "next/navigation"
import { buildAutoData } from "@/lib/checks/auto-data"
import { ensureCurrentRuns, loadRun, pastRuns } from "@/lib/checks/runs"
import { longDate } from "@/lib/format"
import { getOverview } from "@/lib/metrics/overview"
import { createClient } from "@/lib/supabase/server"
import { CheckCard, type Person } from "./check-card"

export default async function ChecksPage({ params, searchParams }: PageProps<"/clients/[slug]/checks">) {
  const { slug } = await params
  const { run: runParam } = await searchParams
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()

  const current = await ensureCurrentRuns(supabase, client.id)
  const runIds = typeof runParam === "string" ? [runParam] : [current.weekly.id, current.monthly.id]

  const [runs, overview, { data: team }, { data: profiles }] = await Promise.all([
    Promise.all(runIds.map((id) => loadRun(supabase, id))),
    getOverview(supabase, client.id),
    supabase.from("client_team").select("profile_id").eq("client_id", client.id),
    supabase.from("profiles").select("id, full_name, email").not("role", "is", null).order("full_name"),
  ])
  const history = await pastRuns(supabase, client.id, [current.weekly.id, current.monthly.id])

  const teamIds = new Set((team ?? []).map((t) => t.profile_id))
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]))
  const people: Person[] = (profiles ?? [])
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email, onTeam: teamIds.has(p.id) }))
    .sort((a, b) => Number(b.onTeam) - Number(a.onTeam) || a.name.localeCompare(b.name))
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)

  return (
    <div className="space-y-12">
      {typeof runParam === "string" && (
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
                  liveData={overview ? buildAutoData(definition.key, overview, { currency: client.currency, target, weekStart: run.period_start }) : null}
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
