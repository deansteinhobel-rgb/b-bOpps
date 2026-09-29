import { notFound } from "next/navigation"
import { londonToday } from "@/lib/checks/periods"
import { loadFeed } from "@/lib/insights/feed"
import { addDays } from "@/lib/metrics/ads"
import { notionWritesLive } from "@/lib/notion/server"
import { peopleForClient } from "@/lib/people"
import { adKey, previewsFor, type PreviewMap } from "@/lib/previews"
import { sprintOf } from "@/lib/sprints/periods"
import { createClient } from "@/lib/supabase/server"
import { InsightFeed } from "./feed"

export const metadata = { title: "Optimise now" }

/**
 * "Optimise now" (Performance phase 3): what to fix or try, from rules over our Windsor data.
 * Nothing is written to the ad platforms; the team acts in the platform and logs it here.
 */
export default async function InsightsPage({ params, searchParams }: PageProps<"/clients/[slug]/insights">) {
  const { slug } = await params
  const { i } = await searchParams
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, name, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  const [feed, people] = await Promise.all([loadFeed(supabase, client.id), peopleForClient(supabase, client.id)]) // access confirmed above
  if (!feed) return <p className="text-muted-foreground">No ad data yet. An admin can run a Windsor backfill for this client.</p>
  const ads = feed.insights.flatMap((x) => (x.ad ? [x.ad] : []))
  const byAd = ads.length ? await previewsFor(supabase, client.id, ads) : {}
  const previews: PreviewMap = Object.fromEntries(feed.insights.flatMap((x) => (x.ad && byAd[adKey(x.ad)] ? [[x.key, byAd[adKey(x.ad)]]] : [])))
  const today = londonToday()

  return (
    <InsightFeed
      slug={slug}
      clientName={client.name}
      currency={client.currency}
      target={client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)}
      insights={feed.insights}
      dataThrough={Object.values(feed.dataThrough).sort().at(-1) ?? null}
      checked={feed.checked}
      previews={previews}
      owners={people.map((p) => ({ id: p.notionUserId, name: p.name, onTeam: p.onTeam }))}
      live={notionWritesLive()}
      defaultDue={addDays(today, 3)}
      sprintNumber={sprintOf(today).number}
      openKey={typeof i === "string" ? i : null}
    />
  )
}
