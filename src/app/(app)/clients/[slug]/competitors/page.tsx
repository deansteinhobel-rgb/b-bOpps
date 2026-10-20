import { notFound } from "next/navigation"
import { canEdit, getProfile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { loadCompetitorPage } from "@/lib/competitors/load"
import { createClient } from "@/lib/supabase/server"
import { CompetitorsView } from "./competitors-view"

export const metadata = { title: "Competitor ads" }
// "Read again" starts the library reads in the background (after()).
export const maxDuration = 300

/** Reporting › Competitor ads: what competitors run, from the public ad libraries, read every other Sunday. */
export default async function CompetitorsPage({ params }: PageProps<"/clients/[slug]/competitors">) {
  const { slug } = await params
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, name").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const today = londonToday()
  const data = await loadCompetitorPage(supabase, client.id, today) // client loaded through RLS above
  return <CompetitorsView slug={slug} clientName={client.name} today={today} canEdit={canEdit(me)} {...data} />
}
