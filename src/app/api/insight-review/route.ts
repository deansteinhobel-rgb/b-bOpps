import { after, NextResponse } from "next/server"
import { getProfile, isAdmin } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { runInsightReview, startInsightReview } from "@/lib/insights/review"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

// A review takes about a minute and runs after the response (see `after`), within this limit.
export const maxDuration = 300

/** "Ask Claude to review" on Optimise now. GTM leads and admins only. Returns the review id to poll. */
export async function POST(request: Request) {
  const me = await getProfile()
  if (!isAdmin(me)) return NextResponse.json({ error: "Only GTM leads and admins can run a review." }, { status: 403 })
  if (!aiConfigured()) return NextResponse.json({ error: "Claude isn't set up yet: add ANTHROPIC_API_KEY to .env.local and restart." }, { status: 503 })
  const { clientSlug } = (await request.json().catch(() => ({}))) as { clientSlug?: string }
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", clientSlug ?? "").maybeSingle()
  if (!client) return NextResponse.json({ error: "This client isn't available to you." }, { status: 404 })

  // One at a time per client (one older than 10 minutes counts as stuck).
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: running } = await supabase.from("insight_reviews").select("id").eq("client_id", client.id).eq("status", "generating").gte("created_at", since).maybeSingle()
  if (running) return NextResponse.json({ reviewId: running.id })
  const limited = await rateLimit(supabase, "insight_review")
  if (limited) return NextResponse.json({ error: limited }, { status: 429 })
  const reviewId = await startInsightReview(client.id, me.id)
  after(() => runInsightReview(reviewId))
  return NextResponse.json({ reviewId })
}

/** Status of a review (read through RLS). */
export async function GET(request: Request) {
  await getProfile()
  const id = new URL(request.url).searchParams.get("review")
  if (!id) return NextResponse.json({ error: "Missing review." }, { status: 400 })
  const supabase = await createClient()
  const { data } = await supabase.from("insight_reviews").select("status, error").eq("id", id).maybeSingle()
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 })
  return NextResponse.json(data)
}
