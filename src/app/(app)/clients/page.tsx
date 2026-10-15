import Link from "next/link"
import { ClientLogo, PlatformIcon } from "@/components/brand"
import { ParticleAmpersand } from "@/components/fx/particle-ampersand"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { getProfile } from "@/lib/auth"
import { clientCards } from "@/lib/clients-summary"
import { longDate } from "@/lib/format"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

export const metadata = { title: "Clients" }

/** Every client's mini dashboard, for everyone (Dean, 2026-10-15). Clients you can't open show the summary only. */
export default async function ClientsPage() {
  const profile = await getProfile()
  const supabase = await createClient()
  // The cards are read with the secret key, so only people with a role get them.
  const cards = profile.role ? await clientCards(supabase) : []
  const first = (profile.full_name ?? "").split(" ")[0]

  return (
    <div className="relative space-y-8">
      <ParticleAmpersand className="pointer-events-none absolute -top-6 right-0 hidden h-40 w-36 opacity-60 xl:block" density={0.8} />
      <PageHeader
        eyebrow="All clients"
        title={first ? `Good to see you, ${first}` : "Clients"}
        description="Pacing, this week's checks and this sprint's tests for every client."
      />
      {cards.length === 0 ? (
        <div className="surface px-6 py-16 text-center text-sm text-muted-foreground">
          No clients yet. Add one in Admin.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <CardShell key={c.id} href={c.canOpen ? `/clients/${c.slug}` : null}>
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-3">
                  <ClientLogo name={c.name} logoUrl={c.logo_url} size="lg" />
                  <span>
                    <span className="block font-heading text-2xl leading-tight">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.team.slice(0, 3).join(", ") || "No team yet"}</span>
                    {!c.canOpen && <span className="block text-[11px] text-subtle-foreground">Not on your team: summary only</span>}
                  </span>
                </span>
                {c.worstPacing && c.worstPacing !== "no_budget" && <StatusBadge status={c.worstPacing} label="Pacing" />}
              </div>

              {/* Pacing per platform */}
              <ul className="space-y-2">
                {c.pacing.map((p) => (
                  <li key={p.platform} className="flex items-center gap-3 text-sm">
                    <PlatformIcon platform={p.platform} />
                    <span className="w-24 text-muted-foreground">{PLATFORM_LABEL[p.platform]}</span>
                    <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
                      <span
                        className={cn("absolute inset-y-0 left-0 rounded-full", p.status === "red" ? "bg-rag-red" : p.status === "amber" ? "bg-rag-amber" : p.status === "green" ? "bg-rag-green" : "bg-rag-na")}
                        style={{ width: `${Math.min((p.ratio ?? 0) * 100, 150) / 1.5}%` }}
                      />
                      <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${100 / 1.5}%` }} />
                    </span>
                    <span className="w-12 text-right tabular-nums">{p.ratio === null ? "–" : `${Math.round(p.ratio * 100)}%`}</span>
                  </li>
                ))}
              </ul>

              <dl className="mt-auto grid grid-cols-4 gap-3 border-t pt-4">
                <Stat label={`Sprint ${c.sprint.number} tests`} value={c.sprint.tests} hint={c.sprint.live ? `${c.sprint.live} live` : undefined} />
                <Stat label="Checks this week" value={c.week && c.week.total ? `${Math.round((c.week.done / c.week.total) * 100)}%` : "0%"} />
                <Stat label="Open actions" value={c.openActions} />
                <Stat label="Reds open" value={c.redsNotActioned} alert={c.redsNotActioned > 0} />
              </dl>
              {c.dataThrough && <p className="-mt-2 text-[11px] text-subtle-foreground">Ad data through {longDate(c.dataThrough)}</p>}
            </CardShell>
          ))}
        </div>
      )}
    </div>
  )
}

/** A card links into the client when you can open it; otherwise it's the summary on its own. */
function CardShell({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = "group surface flex flex-col gap-5 p-5 transition-colors"
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-foreground/20")}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  )
}

function Stat({ label, value, hint, alert }: { label: string; value: string | number; hint?: string; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("font-heading text-2xl leading-tight", alert && "text-rag-red")}>{value}</dd>
      {hint && <dd className="text-[11px] text-lime">{hint}</dd>}
    </div>
  )
}
