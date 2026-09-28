import Link from "next/link"
import { fieldClass } from "@/components/admin-form"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { longDate } from "@/lib/format"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { CARRY_REASONS } from "@/lib/sprints/tests"
import { createClient } from "@/lib/supabase/server"

type Row = {
  id: string
  platform: Platform | null
  title: string
  hypothesis: string | null
  outcome: "proven" | "disproven" | "inconclusive" | "carried"
  carry_reason: string | null
  findings_worked: string | null
  findings_blockers: string | null
  findings_notes: string | null
  sprints: { number: number; start_date: string } | null
  clients: { name: string; slug: string } | null
}
const OUTCOME = { proven: ["green", "Proven"], disproven: ["red", "Disproven"], inconclusive: ["na", "Inconclusive"], carried: ["amber", "Carried over"] } as const

/**
 * The library of what we've learned: every test that has been called, across sprints and clients the
 * user can see (RLS). Carried-over tests show under the sprint that finally called them.
 */
export default async function LearningsPage({ searchParams }: PageProps<"/learnings">) {
  const { q, client, outcome } = await searchParams
  const query = typeof q === "string" ? q.trim().toLowerCase() : ""
  const clientSlug = typeof client === "string" ? client : ""
  const outcomeFilter = typeof outcome === "string" ? outcome : ""
  const supabase = await createClient()
  const [{ data: clients }, { data: rows }] = await Promise.all([
    supabase.from("clients").select("id, name, slug").eq("active", true).order("name"),
    supabase
      .from("sprint_tests")
      .select("id, platform, title, hypothesis, outcome, carry_reason, findings_worked, findings_blockers, findings_notes, sprints(number, start_date), clients(name, slug)")
      .in("outcome", ["proven", "disproven", "inconclusive"])
      .order("updated_at", { ascending: false })
      .limit(500),
  ])
  const all = (rows ?? []) as unknown as Row[]
  const filtered = all.filter(
    (r) =>
      (!clientSlug || r.clients?.slug === clientSlug) &&
      (!outcomeFilter || r.outcome === outcomeFilter) &&
      (!query || [r.title, r.hypothesis, r.findings_worked, r.findings_blockers, r.findings_notes].some((s) => s?.toLowerCase().includes(query))),
  )

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Across all sprints</p>
        <h1 className="mt-2 text-4xl">Learnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every test we&apos;ve called, and what we learned. What worked for one client can help another.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" action="/learnings">
        <Input name="q" defaultValue={typeof q === "string" ? q : ""} placeholder="Search tests and findings…" className="max-w-sm bg-card" aria-label="Search" />
        <select name="client" defaultValue={clientSlug} className={`${fieldClass} w-44`} aria-label="Client">
          <option value="">All clients</option>
          {(clients ?? []).map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="outcome" defaultValue={outcomeFilter} className={`${fieldClass} w-44`} aria-label="Outcome">
          <option value="">All outcomes</option>
          <option value="proven">Proven</option>
          <option value="disproven">Disproven</option>
          <option value="inconclusive">Inconclusive</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{all.length === 0 ? "No tests have been called yet. They appear here once a test is proven, disproven or inconclusive." : "Nothing matches."}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {filtered.map((r) => (
            <li key={r.id} className="space-y-2 rounded-lg border bg-card p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status={OUTCOME[r.outcome][0]} label={OUTCOME[r.outcome][1]} />
                {r.clients && <span className="font-bold text-foreground">{r.clients.name}</span>}
                {r.platform && <span>{PLATFORM_LABEL[r.platform]}</span>}
                {r.sprints && r.clients && (
                  <Link href={`/clients/${r.clients.slug}/sprint?n=${r.sprints.number}`} className="underline">
                    Sprint {r.sprints.number} · {longDate(r.sprints.start_date)}
                  </Link>
                )}
              </div>
              <p className="font-bold">{r.title}</p>
              {r.hypothesis && <p className="text-xs text-muted-foreground">Hypothesis: {r.hypothesis}</p>}
              {r.findings_worked && (
                <p>
                  <span className="text-xs text-muted-foreground">What worked: </span>
                  {r.findings_worked}
                </p>
              )}
              {r.findings_blockers && (
                <p>
                  <span className="text-xs text-muted-foreground">Blocker: </span>
                  {r.findings_blockers}
                </p>
              )}
              {r.findings_notes && <p className="text-xs text-muted-foreground">{r.findings_notes}</p>}
              {r.carry_reason && <p className="text-xs text-muted-foreground">{CARRY_REASONS[r.carry_reason]}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
