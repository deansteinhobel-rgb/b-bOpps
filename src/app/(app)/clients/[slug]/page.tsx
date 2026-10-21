import { Suspense } from "react"
import { notFound } from "next/navigation"
import { SectionLoading } from "@/components/loading"
import { latestDataDay } from "@/lib/account"
import { canEdit, getProfile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { loadWeeklyRead } from "@/lib/reports/weekly-read"
import { sprintOf } from "@/lib/sprints/periods"
import { createClient } from "@/lib/supabase/server"
import { GlanceCards } from "./_glance/glance-cards"
import { loadGoals } from "./_glance/glance-data"
import { GoalsRow } from "./_read/goals-row"
import { ReadView } from "./_read/read-view"

export const metadata = { title: "Summary" }

/**
 * Summary, this month (Dean, 2026-10-21: "replace the summary page with the look and feel" of the weekly
 * read, on the month so far). The month against the same days last month: the verdict, the client's goals,
 * what's working / needs attention / where to act, the numbers, the evidence and the flags, then What's
 * changed and What's planned (their full sections open in a side panel, ?view=changes|plans).
 */
export default async function SummaryPage({ params, searchParams }: PageProps<"/clients/[slug]">) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, name, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  return (
    <Suspense fallback={<SectionLoading label="Reading the month…" className="min-h-96" lines={8} />}>
      <MonthRead supabase={supabase} client={client} abx={sp.abx === "1"} />
    </Suspense>
  )
}

async function MonthRead({ supabase, client, abx }: { supabase: Awaited<ReturnType<typeof createClient>>; client: { id: string; slug: string; name: string; currency: string; monthly_kpi_target: number | string | null }; abx: boolean }) {
  const today = londonToday()
  // Access confirmed above (client loaded through RLS); the read uses the secret key for its numbers.
  const [read, goals, me] = await Promise.all([loadWeeklyRead(supabase, client, { kind: "month" }), loadGoals(supabase, client.id, today), getProfile()])
  // No goals: nothing beside the verdict, so it takes the full width.
  const goalsRow = goals.length ? <GoalsRow slug={client.slug} goals={goals} canEdit={canEdit(me)} /> : undefined
  const cards = (
    <section className="grid gap-3 lg:grid-cols-2">
      <GlanceCards withAds={false} supabase={supabase} slug={client.slug} client={client} today={today} period={sprintOf(today)} through={latestDataDay(supabase, client.id)} />
    </section>
  )
  if (!read)
    return (
      <div className="space-y-6">
        <p className="surface px-5 py-6 text-sm text-muted-foreground">No ad data yet. Once an ad account is connected and synced, this month&apos;s numbers show here.</p>
        {goalsRow}
        {cards}
      </div>
    )
  return <ReadView read={read} initialAbx={abx} goals={goalsRow} below={cards} />
}
