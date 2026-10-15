import Link from "next/link"
import { ClientLogo, PlatformIcon } from "@/components/brand"
import { ParticleAmpersand } from "@/components/fx/particle-ampersand"
import { PageHeader } from "@/components/page-header"
import { getProfile } from "@/lib/auth"
import { clientCards, type ClientCard } from "@/lib/clients-summary"
import { compactMoney, longDate, whole } from "@/lib/format"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { paceOf, type FunnelMetric } from "@/lib/mock-funnel"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

export const metadata = { title: "Clients" }

const FILL = { green: "bg-rag-green", amber: "bg-rag-amber", red: "bg-rag-red", no_budget: "bg-white/25" } as const
const TEXT = { green: "text-rag-green", amber: "text-rag-amber", red: "text-rag-red" } as const

/**
 * Every client's mini dashboard, for everyone (Dean, 2026-10-15). Each card answers "where are we this
 * month": spend per platform against budget (amounts, with a mark for where spend should be today), then
 * MQLs, SQLs and pipeline against target (sample numbers until the CRM is connected), then the sprint
 * and checks in one line. Clients you can't open show the summary only.
 */
export default async function ClientsPage() {
  const profile = await getProfile()
  const supabase = await createClient()
  // The cards are read with the secret key, so only people with a role get them.
  const cards = profile.role ? await clientCards(supabase) : []
  const first = (profile.full_name ?? "").split(" ")[0]
  const day = cards[0] ? Math.round(cards[0].monthPace * 100) : null

  return (
    <div className="relative space-y-6">
      <ParticleAmpersand className="pointer-events-none absolute -top-6 right-0 hidden h-40 w-36 opacity-60 xl:block" density={0.8} />
      <PageHeader
        eyebrow="All clients"
        title={first ? `Good to see you, ${first}` : "Clients"}
        description={`Spend against budget and the funnel against target, this month so far${day !== null ? ` (${day}% of the month gone)` : ""}.`}
      />
      {cards.length === 0 ? (
        <div className="surface px-6 py-16 text-center text-sm text-muted-foreground">No clients yet. Add one in Admin.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <CardShell key={c.id} href={c.canOpen ? `/clients/${c.slug}` : null}>
              <header className="flex items-center gap-3">
                <ClientLogo name={c.name} logoUrl={c.logo_url} size="md" className="size-9 rounded-lg" />
                <div className="min-w-0">
                  <h2 className="truncate text-xl leading-7">{c.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">{c.canOpen ? c.team.slice(0, 3).join(", ") || "No team yet" : "Not on your team: summary only"}</p>
                </div>
              </header>

              <Spend card={c} />
              <FunnelBlock card={c} />

              <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                <span>
                  Sprint {c.sprint.number}: <span className="text-body">{c.sprint.tests} tests</span>
                  {c.sprint.live > 0 && <span className="text-body"> · {c.sprint.live} live</span>}
                </span>
                <span>
                  Checks <span className="text-body tabular-nums">{c.week && c.week.total ? `${Math.round((c.week.done / c.week.total) * 100)}%` : "0%"}</span>
                </span>
                {c.redsNotActioned > 0 && <span className="text-rag-red">{c.redsNotActioned} red{c.redsNotActioned === 1 ? "" : "s"} open</span>}
                {c.dataThrough && <span className="ml-auto">Data to {longDate(c.dataThrough)}</span>}
              </footer>
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
    <Link href={href} className={cn(cls, "outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring")}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  )
}

function BlockTitle({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {trailing}
    </div>
  )
}

/** A thin bar: how much of the whole is done, and a tick for where it should be by today. */
function Bar({ share, pace, tone }: { share: number; pace: number | null; tone: string }) {
  return (
    <span className="relative block h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden>
      <span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.max(0, Math.min(share, 1)) * 100}%` }} />
      {pace !== null && <span className="absolute -inset-y-px w-0.5 bg-foreground/70" style={{ left: `calc(${Math.min(pace, 1) * 100}% - 1px)` }} />}
    </span>
  )
}

/** Spend per platform: the amount spent against the month's budget, colored by pacing. */
function Spend({ card: c }: { card: ClientCard }) {
  if (!c.pacing.length) {
    return (
      <section>
        <BlockTitle>Spend this month</BlockTitle>
        <p className="text-[13px] text-muted-foreground">No ad accounts connected yet.</p>
      </section>
    )
  }
  const spent = c.pacing.reduce((t, p) => t + p.spendMtd, 0)
  const budget = c.pacing.reduce((t, p) => t + (p.budget ?? 0), 0)
  return (
    <section>
      <BlockTitle
        trailing={
          <span className="text-xs text-muted-foreground tabular-nums">
            <span className="text-foreground">{compactMoney(spent, c.currency)}</span>
            {budget > 0 && ` of ${compactMoney(budget, c.currency)}`}
          </span>
        }
      >
        Spend this month
      </BlockTitle>
      <ul className="space-y-2.5">
        {c.pacing.map((p) => {
          const words = p.budget ? (p.status === "green" ? "On pace" : p.variancePct === null ? "" : `${Math.round(Math.abs(p.variancePct))}% ${p.variancePct > 0 ? "over" : "under"} pace`) : "No budget set"
          return (
            <li key={p.platform} className="space-y-1.5" title={`${PLATFORM_LABEL[p.platform]}: ${words}`}>
              <div className="flex items-center gap-2 text-[13px]">
                <PlatformIcon platform={p.platform} />
                <span className="min-w-0 flex-1 truncate text-body">{PLATFORM_LABEL[p.platform]}</span>
                <span className="tabular-nums">
                  <span className="font-medium">{compactMoney(p.spendMtd, c.currency)}</span>
                  <span className="text-muted-foreground">{p.budget ? ` / ${compactMoney(p.budget, c.currency)}` : ""}</span>
                </span>
              </div>
              <Bar share={p.budget ? p.spendMtd / p.budget : 0} pace={p.budget ? p.daysElapsed / p.daysInMonth : null} tone={FILL[p.status]} />
              <p className={cn("text-xs", p.budget && p.status !== "no_budget" ? TEXT[p.status] : "text-muted-foreground")}>{words}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** MQLs, SQLs and pipeline against target, side by side. */
function FunnelBlock({ card: c }: { card: ClientCard }) {
  return (
    <section>
      <BlockTitle trailing={c.funnel.sample && <span className="rounded px-1.5 text-xs leading-5 text-muted-foreground ring-1 ring-white/10 ring-inset" title="Made-up numbers until the CRM is connected">Sample</span>}>Funnel this month</BlockTitle>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-white/[0.06]">
        {c.funnel.metrics.map((m) => (
          <FunnelCell key={m.key} metric={m} pace={c.monthPace} currency={c.currency} />
        ))}
      </div>
    </section>
  )
}

function FunnelCell({ metric: m, pace, currency }: { metric: FunnelMetric; pace: number; currency: string }) {
  const p = paceOf(m.value, m.target, pace)
  const fmt = (v: number) => (m.money ? compactMoney(v, currency) : whole(v))
  return (
    <div className="min-w-0 space-y-2 bg-card px-3 py-3" title={`${m.hint}: ${fmt(m.value)} of ${fmt(m.target)}, ${p.words.toLowerCase()}${p.words === "On pace" ? "" : " of pace"}`}>
      <p className="text-xs text-muted-foreground">{m.label}</p>
      <div className="tabular-nums">
        <p className="truncate text-xl leading-7 font-semibold">{fmt(m.value)}</p>
        <p className="truncate text-xs text-muted-foreground">of {fmt(m.target)}</p>
      </div>
      <Bar share={m.value / m.target} pace={pace} tone={FILL[p.tone]} />
      <p className={cn("truncate text-xs", TEXT[p.tone])}>{p.words}</p>
    </div>
  )
}
