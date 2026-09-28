import Link from "next/link"
import { fieldClass } from "@/components/admin-form"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { longDate } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

type Row = {
  id: string
  kind: "learning" | "hypothesis" | "carried"
  text: string
  outcome: "proven" | "disproven" | "inconclusive" | null
  origin_kind: string | null
  sprints: { number: number; start_date: string } | null
  clients: { name: string; slug: string } | null
}

/**
 * Every learning and tested hypothesis across sprints (the "6x the learning" library), for the
 * clients the user can see (RLS). Carried copies are left out so each learning shows once.
 */
export default async function LearningsPage({ searchParams }: PageProps<"/learnings">) {
  const { q, client } = await searchParams
  const query = typeof q === "string" ? q.trim() : ""
  const clientSlug = typeof client === "string" ? client : ""
  const supabase = await createClient()
  const [{ data: clients }, { data: rows }] = await Promise.all([
    supabase.from("clients").select("id, name, slug").eq("active", true).order("name"),
    supabase
      .from("sprint_items")
      .select("id, kind, text, outcome, origin_kind, sprints(number, start_date), clients(name, slug)")
      .or("kind.eq.learning,and(kind.eq.hypothesis,outcome.not.is.null)")
      .neq("status", "dropped")
      .order("created_at", { ascending: false })
      .limit(500),
  ])
  const all = (rows ?? []) as unknown as Row[]
  const filtered = all.filter(
    (r) => (!clientSlug || r.clients?.slug === clientSlug) && (!query || r.text.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Across all sprints</p>
        <h1 className="mt-2 text-4xl">Learnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every learning and tested hypothesis from sprint reviews. A learning from one client can help another.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" action="/learnings">
        <Input name="q" defaultValue={query} placeholder="Search learnings…" className="max-w-sm bg-card" aria-label="Search learnings" />
        <select name="client" defaultValue={clientSlug} className={`${fieldClass} w-48`} aria-label="Client">
          <option value="">All clients</option>
          {(clients ?? []).map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{all.length === 0 ? "No learnings yet. They appear here as sprint reviews are filled in." : "Nothing matches."}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {filtered.map((r) => (
            <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {r.clients && <span className="font-bold text-foreground">{r.clients.name}</span>}
                {r.sprints && r.clients && (
                  <Link href={`/clients/${r.clients.slug}/sprint?n=${r.sprints.number}`} className="underline">
                    Sprint {r.sprints.number} · {longDate(r.sprints.start_date)}
                  </Link>
                )}
                {r.kind === "hypothesis" && r.outcome && (
                  <StatusBadge status={r.outcome === "proven" ? "green" : r.outcome === "disproven" ? "red" : "na"} label={`Hypothesis ${r.outcome}`} />
                )}
              </div>
              <p className="whitespace-pre-line">{r.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
