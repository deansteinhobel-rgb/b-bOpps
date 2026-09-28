import Link from "next/link"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getProfile, isAdmin } from "@/lib/auth"
import { clientCards } from "@/lib/clients-summary"
import { longDate } from "@/lib/format"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const profile = await getProfile()
  const admin = isAdmin(profile)
  const { all } = await searchParams
  // Defaults to "my clients". Admins can switch to all clients.
  const showAll = admin && all === "1"
  const supabase = await createClient()
  const cards = await clientCards(supabase, { profileId: profile.id, onlyMine: !showAll })

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{showAll ? "All clients" : "My clients"}</p>
          <h1 className="mt-2 text-4xl">Clients</h1>
        </div>
        {admin && (
          <div className="flex gap-1 rounded-full border bg-card p-1 text-sm">
            <Link href="/clients" className={cn("rounded-full px-3 py-1", !showAll && "bg-ink text-white")}>
              My clients
            </Link>
            <Link href="/clients?all=1" className={cn("rounded-full px-3 py-1", showAll && "bg-ink text-white")}>
              All clients
            </Link>
          </div>
        )}
      </div>

      {cards.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          {showAll ? "No clients yet. Add one in Admin." : admin ? "You're not on any client team. Switch to All clients." : "You're not assigned to a client yet. Ask Dean or Esa."}
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.id} href={`/clients/${c.slug}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <CardTitle className="font-heading text-2xl font-normal">{c.name}</CardTitle>
                  {c.worstPacing && <StatusBadge status={c.worstPacing} label={`Pacing ${c.worstPacing === "no_budget" ? "–" : c.worstPacing}`} />}
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    {c.pacing.map((p) => (
                      <StatusBadge key={p.platform} status={p.status} label={`${PLATFORM_LABEL[p.platform]} ${p.ratio === null ? "–" : `${Math.round(p.ratio * 100)}%`}`} />
                    ))}
                  </div>
                  <dl className="grid grid-cols-3 gap-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Checks this week</dt>
                      <dd className="font-heading text-2xl">{c.week && c.week.total ? `${Math.round((c.week.done / c.week.total) * 100)}%` : "0%"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Open actions</dt>
                      <dd className="font-heading text-2xl">{c.openActions}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Reds not actioned</dt>
                      <dd className={cn("font-heading text-2xl", c.redsNotActioned > 0 && "text-rag-red")}>{c.redsNotActioned}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {c.team.join(", ") || "No team assigned"}
                    {c.dataThrough && ` · data through ${longDate(c.dataThrough)}`}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
