import { Suspense } from "react"
import { notFound } from "next/navigation"
import { SectionLoading } from "@/components/loading"
import { canEdit, getProfile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { addDays } from "@/lib/metrics/ads"
import { lastWeek } from "@/lib/reports/weekly"
import { loadWeeklyRead } from "@/lib/reports/weekly-read"
import { createClient } from "@/lib/supabase/server"
import { loadGoals } from "../_glance/glance-data"
import { GoalsRow } from "../_read/goals-row"
import { ReadView } from "../_read/read-view"

export const metadata = { title: "Weekly read" }

/** A Monday on or before last week's, or last week. */
function parseWeek(v: unknown) {
  const last = lastWeek(londonToday())
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return last
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.getUTCDay() !== 1 || v > last.from) return last
  return { from: v, to: addDays(v, 6) }
}

/**
 * Weekly read (Dean, 2026-10-21, after ZenABM's reports): Summary › Weekly read, last week against the week
 * before, in the Summary's layout. Overall for every client; ABX for clients with an account-based segment.
 */
export default async function WeeklyReadPage({ params, searchParams }: PageProps<"/clients/[slug]/weekly">) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const week = parseWeek(sp.week)
  return (
    <Suspense key={week.from} fallback={<SectionLoading label="Reading the week…" className="min-h-96" lines={8} />}>
      <WeeklyRead supabase={supabase} client={client} week={week} abx={sp.abx === "1"} />
    </Suspense>
  )
}

async function WeeklyRead({ supabase, client, week, abx }: { supabase: Awaited<ReturnType<typeof createClient>>; client: { id: string; slug: string; monthly_kpi_target: number | string | null }; week: { from: string; to: string }; abx: boolean }) {
  // Access confirmed above (client loaded through RLS); the read uses the secret key for its numbers.
  const [read, goals, me] = await Promise.all([loadWeeklyRead(supabase, client, { kind: "week", ...week }), loadGoals(supabase, client.id, week.to), getProfile()])
  if (!read) return <p className="text-sm text-muted-foreground">No ad data for this client yet.</p>
  const latest = lastWeek(londonToday()).from
  return (
    <ReadView
      read={read}
      initialAbx={abx}
      nav={{ prev: addDays(week.from, -7), next: week.from < latest ? addDays(week.from, 7) : null, isLatest: week.from === latest }}
      goals={<GoalsRow slug={client.slug} goals={goals} canEdit={canEdit(me)} />}
    />
  )
}
