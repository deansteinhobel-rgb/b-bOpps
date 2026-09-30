import { NextResponse } from "next/server"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { londonToday } from "@/lib/checks/periods"
import { writeTermReview } from "@/lib/insights/term-review"
import { rateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

// 300 terms against the brief takes about a minute; the table waits for it.
export const maxDuration = 300

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** "Check against the ICP" for one Google campaign's search terms (last 30 days of synced data). The client's team, not viewers. */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!canEdit(me)) return NextResponse.json({ error: VIEW_ONLY }, { status: 403 })
  if (!aiConfigured()) return NextResponse.json({ error: "Claude isn't set up yet (ANTHROPIC_API_KEY)." }, { status: 503 })
  const { slug, campaignId } = (await request.json().catch(() => ({}))) as { slug?: string; campaignId?: string }
  if (!slug || !campaignId || !/^\d{1,20}$/.test(campaignId)) return NextResponse.json({ error: "Missing campaign." }, { status: 400 })
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, name, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) return NextResponse.json({ error: "This client isn't available to you." }, { status: 404 })

  const [{ data: latest }, { data: review }] = await Promise.all([
    supabase.from("windsor_breakdowns").select("date, campaign_name").eq("client_id", client.id).eq("kind", "search_term").eq("campaign_id", campaignId).order("date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("insight_reviews").select("goals").eq("client_id", client.id).eq("status", "ready").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!latest) return NextResponse.json({ error: "No search terms synced for this campaign yet." }, { status: 400 })
  const goal = ((review?.goals ?? []) as { platform: string; campaign_id: string; goal: string; note: string }[]).find((g) => g.platform === "google_ads" && g.campaign_id === campaignId)

  const limited = await rateLimit(supabase, "term_review")
  if (limited) return NextResponse.json({ error: limited }, { status: 429 })
  const to = latest.date as string
  try {
    // Access was checked above with the user's client, which also reads the terms; the admin client only writes term_reviews.
    const result = await writeTermReview(createAdminClient(), supabase, {
      clientId: client.id,
      clientName: client.name,
      currency: client.currency,
      target: client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target),
      campaign: { id: campaignId, name: String(latest.campaign_name ?? campaignId), goal: goal ? `${goal.goal}${goal.note ? `: ${goal.note}` : ""}` : null },
      from: addDays(to, -29),
      to,
      today: londonToday(),
      requestedBy: me.id,
    })
    return NextResponse.json({ review: result })
  } catch (e) {
    console.error("term review failed", e)
    return NextResponse.json({ error: "Claude couldn't check these terms just now. Try again in a minute." }, { status: 502 })
  }
}
