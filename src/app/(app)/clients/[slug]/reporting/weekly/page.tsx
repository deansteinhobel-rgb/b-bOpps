import { Suspense } from "react"
import { notFound } from "next/navigation"
import { SectionLoading } from "@/components/loading"
import { londonToday } from "@/lib/checks/periods"
import { addDays } from "@/lib/metrics/ads"
import { lastWeek } from "@/lib/reports/weekly"
import { loadWeeklyRead } from "@/lib/reports/weekly-read"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { WeeklyReadView } from "./weekly-read-view"

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
 * Weekly read (Dean, 2026-10-21, after ZenABM's reports): last week for one client, easy to digest.
 * The verdict first, then what's working / needs attention / where to act, then the numbers and the
 * evidence. Overall for every client; ABX for clients with an account-based segment (Camber).
 */
export default async function WeeklyReadPage({ params, searchParams }: PageProps<"/clients/[slug]/reporting/weekly">) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const week = parseWeek(sp.week)
  return (
    <Suspense key={week.from} fallback={<SectionLoading label="Reading the week…" className="min-h-96" lines={8} />}>
      <WeeklyRead supabase={supabase} client={client} week={week} view={sp.view === "abx" ? "abx" : "overall"} />
    </Suspense>
  )
}

async function WeeklyRead({ supabase, client, week, view }: { supabase: Awaited<ReturnType<typeof createClient>>; client: { id: string; slug: string; monthly_kpi_target: number | string | null }; week: { from: string; to: string }; view: "overall" | "abx" }) {
  // Access confirmed above (client loaded through RLS), so the secret key is safe to read with.
  const read = await loadWeeklyRead(createAdminClient(), supabase, client, week)
  if (!read) return <p className="text-sm text-muted-foreground">No ad data for this client yet.</p>
  const latest = lastWeek(londonToday()).from
  return <WeeklyReadView read={read} initialView={read.abx ? view : "overall"} prevWeek={addDays(week.from, -7)} nextWeek={week.from < latest ? addDays(week.from, 7) : null} isLatest={week.from === latest} />
}
