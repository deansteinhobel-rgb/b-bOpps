import Link from "next/link"
import { fieldClass } from "@/components/admin-form"
import { ClientLogo, PlatformIcon } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import { Input } from "@/components/ui/input"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { PourTag } from "../clients/[slug]/sprint/test-card"

export const metadata = { title: "Learnings" }

type Outcome = "proven" | "disproven" | "inconclusive"
type Row = {
  id: string
  platform: Platform | null
  title: string
  hypothesis: string | null
  outcome: Outcome
  success_text: string | null
  findings_worked: string | null
  findings_blockers: string | null
  findings_notes: string | null
  recommendation_id: string | null
  sprints: { number: number; start_date: string } | null
  clients: { name: string; slug: string; logo_url: string | null } | null
}

const OUTCOMES: { key: Outcome; label: string; dot: string; text: string }[] = [
  { key: "proven", label: "Proven", dot: "bg-rag-green", text: "text-rag-green" },
  { key: "disproven", label: "Disproven", dot: "bg-rag-red", text: "text-rag-red" },
  { key: "inconclusive", label: "Inconclusive", dot: "bg-rag-na", text: "text-rag-na" },
]
const meta = Object.fromEntries(OUTCOMES.map((o) => [o.key, o])) as Record<Outcome, (typeof OUTCOMES)[number]>

/** Every called test and what we learned, across sprints and clients the user can see (RLS). */
export default async function LearningsPage({ searchParams }: PageProps<"/learnings">) {
  const sp = await searchParams
  const q = typeof sp.q === "string" ? sp.q.trim() : ""
  const clientSlug = typeof sp.client === "string" ? sp.client : ""
  const outcome = typeof sp.outcome === "string" ? (sp.outcome as Outcome) : ""
  const fromPour = sp.from === "pour"
  const supabase = await createClient()
  const [{ data: clients }, { data: rows }] = await Promise.all([
    supabase.from("clients").select("id, name, slug").eq("active", true).order("name"),
    supabase
      .from("sprint_tests")
      .select("id, platform, title, hypothesis, outcome, success_text, findings_worked, findings_blockers, findings_notes, recommendation_id, sprints(number, start_date), clients(name, slug, logo_url)")
      .in("outcome", ["proven", "disproven", "inconclusive"])
      .order("updated_at", { ascending: false })
      .limit(500),
  ])
  const all = (rows ?? []) as unknown as Row[]
  const needle = q.toLowerCase()
  const scoped = all.filter(
    (r) => (!clientSlug || r.clients?.slug === clientSlug) && (!fromPour || r.recommendation_id) && (!needle || [r.title, r.hypothesis, r.findings_worked, r.findings_blockers, r.findings_notes].some((s) => s?.toLowerCase().includes(needle))),
  )
  const visible = scoped.filter((r) => !outcome || r.outcome === outcome)
  const href = (o: string, pour = fromPour) => {
    const p = new URLSearchParams()
    if (q) p.set("q", q)
    if (clientSlug) p.set("client", clientSlug)
    if (o) p.set("outcome", o)
    if (pour) p.set("from", "pour")
    return `/learnings${p.size ? `?${p}` : ""}`
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Across all sprints" title="Learnings" description="Every test we've called, and what it taught us. What worked for one client can help another." />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Outcome filter with counts */}
        <nav className="flex flex-wrap gap-1.5" aria-label="Filter by outcome">
          <FilterPill href={href("")} active={!outcome} label="All" count={scoped.length} />
          {OUTCOMES.map((o) => (
            <FilterPill key={o.key} href={href(o.key)} active={outcome === o.key} label={o.label} count={scoped.filter((r) => r.outcome === o.key).length} dot={o.dot} />
          ))}
          <span className="mx-1 hidden w-px self-stretch bg-border sm:block" aria-hidden />
          <Link
            href={href(outcome, !fromPour)}
            aria-current={fromPour ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors",
              fromPour ? "border-rag-green/40 bg-rag-green/10 text-rag-green" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            Pour a Sprint only
            <span className="text-xs tabular-nums opacity-70">{all.filter((r) => r.recommendation_id && (!clientSlug || r.clients?.slug === clientSlug)).length}</span>
          </Link>
        </nav>
        <form className="flex gap-2" action="/learnings">
          {outcome && <input type="hidden" name="outcome" value={outcome} />}
          {fromPour && <input type="hidden" name="from" value="pour" />}
          <Input name="q" defaultValue={q} placeholder="Search tests and findings" className="h-9 w-64 bg-card" aria-label="Search" />
          <select name="client" defaultValue={clientSlug} className={cn(fieldClass, "w-40")} aria-label="Client">
            <option value="">All clients</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-accent">
            Apply
          </button>
        </form>
      </div>

      {visible.length === 0 ? (
        <div className="surface px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">{all.length === 0 ? "No tests have been called yet. They appear here once a test is proven, disproven or inconclusive." : "Nothing matches these filters."}</p>
        </div>
      ) : (
        <ul className="surface divide-y overflow-hidden">
          {visible.map((r) => (
            <li key={r.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3.5 transition-colors hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
                  <span className={cn("size-2 shrink-0 rounded-full", meta[r.outcome].dot)} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={meta[r.outcome].text}>{meta[r.outcome].label}</span>
                      {r.recommendation_id && <PourTag />}
                      {(r.findings_worked || r.findings_blockers) && <span className="hidden truncate sm:inline">· {r.findings_worked ?? r.findings_blockers}</span>}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground md:flex">
                    {r.clients && (
                      <span className="flex items-center gap-1.5">
                        <ClientLogo name={r.clients.name} logoUrl={r.clients.logo_url} size="xs" />
                        {r.clients.name}
                      </span>
                    )}
                    <span className="flex w-28 items-center gap-1.5" title={r.platform ? PLATFORM_LABEL[r.platform] : "Several platforms"}>
                      <PlatformIcon platform={r.platform} />
                      <span className="truncate">{r.platform ? PLATFORM_LABEL[r.platform] : "Several"}</span>
                    </span>
                    {r.sprints && <span className="w-16 text-right tabular-nums">Sprint {r.sprints.number}</span>}
                  </span>
                  <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-subtle-foreground transition-transform group-open:rotate-90" aria-hidden>
                    <path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="space-y-4 border-t bg-background/40 px-4 py-4 sm:pl-10">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Finding tone="green" label="What worked" text={r.findings_worked} />
                    <Finding tone="red" label="Blocker" text={r.findings_blockers} />
                  </div>
                  <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                    {r.hypothesis && <Meta label="Hypothesis" value={r.hypothesis} />}
                    {r.success_text && <Meta label="Success looked like" value={r.success_text} />}
                    {r.findings_notes && <Meta label="Notes" value={r.findings_notes} />}
                  </dl>
                  {r.clients && r.sprints && (
                    <Link href={`/clients/${r.clients.slug}/sprint?n=${r.sprints.number}`} className="inline-block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                      Open Sprint {r.sprints.number} for {r.clients.name} →
                    </Link>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilterPill({ href, active, label, count, dot }: { href: string; active: boolean; label: string; count: number; dot?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors",
        active ? "border-foreground/20 bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />}
      {label}
      <span className="text-xs text-subtle-foreground tabular-nums">{count}</span>
    </Link>
  )
}

function Finding({ tone, label, text }: { tone: "green" | "red"; label: string; text: string | null }) {
  return (
    <div className={cn("rounded-md border-l-2 bg-card px-3 py-2.5", tone === "green" ? "border-l-rag-green" : "border-l-rag-red")}>
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 text-sm leading-relaxed", !text && "text-subtle-foreground italic")}>{text ?? "None recorded"}</p>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 leading-relaxed">{value}</dd>
    </div>
  )
}
