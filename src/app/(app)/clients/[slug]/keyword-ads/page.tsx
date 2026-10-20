import { notFound } from "next/navigation"
import { canEdit, getProfile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { loadKeywordPage } from "@/lib/competitors/keyword-load"
import { createClient } from "@/lib/supabase/server"
import { KeywordAdsView } from "./keyword-ads-view"

export const metadata = { title: "Keyword ads" }
// "Read again" starts the library reads in the background (after()).
export const maxDuration = 300

/** Knowledge › Keyword ads: the market by keyword on Meta and LinkedIn, the longest-running ads first. */
export default async function KeywordAdsPage({ params, searchParams }: PageProps<"/clients/[slug]/keyword-ads">) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, name").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const source = sp.s === "meta" || sp.s === "linkedin" ? sp.s : undefined
  const data = await loadKeywordPage(supabase, client, { keywordId: typeof sp.k === "string" ? sp.k : undefined, source }) // client loaded through RLS above
  return <KeywordAdsView slug={slug} clientName={client.name} today={londonToday()} canEdit={canEdit(me)} {...data} />
}
