import { NextResponse } from "next/server"
import { canEdit, getProfile } from "@/lib/auth"
import { aiConfigured } from "@/lib/ai/claude"
import { londonToday } from "@/lib/checks/periods"
import { rateLimit } from "@/lib/rate-limit"
import type { SprintTest } from "@/lib/sprints/data"
import { writeTestRead } from "@/lib/sprints/test-read"
import { loadTestDetail } from "@/lib/sprints/test-results"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

// A read takes 20-60 seconds; the panel waits for it.
export const maxDuration = 120

/**
 * Claude's read on a live test (Dean, 2026-09-30): today's stored read, or a new one written once a
 * day per test (the first person on the client's team to open the test that day starts it, or
 * "Get a fresh read"). Viewers see stored reads only.
 */
export async function POST(request: Request) {
  const me = await getProfile()
  const { testId, fresh } = (await request.json().catch(() => ({}))) as { testId?: string; fresh?: boolean }
  if (!testId) return NextResponse.json({ error: "Missing test." }, { status: 400 })
  const supabase = await createClient()
  const { data: test } = await supabase.from("sprint_tests").select("*, clients(id, currency, monthly_kpi_target)").eq("id", testId).maybeSingle()
  if (!test) return NextResponse.json({ error: "This test isn't available to you." }, { status: 404 })
  const today = londonToday()
  const { data: stored } = await supabase
    .from("test_reads")
    .select("verdict, confidence, headline, points, next_step, next_step_kind, created_at, read_on")
    .eq("sprint_test_id", testId)
    .order("read_on", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (stored && stored.read_on === today && !fresh) return NextResponse.json({ read: stored })
  if (!canEdit(me) || !aiConfigured()) return NextResponse.json({ read: stored ?? null })

  const limited = await rateLimit(supabase, "test_read")
  if (limited) return NextResponse.json({ read: stored ?? null, error: limited }, { status: 429 })
  const client = test.clients as { id: string; currency: string; monthly_kpi_target: number | null }
  const opts = { today, currency: client.currency, targetCpr: client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target) }
  const detail = await loadTestDetail(supabase, client.id, test as SprintTest, opts)
  if (!detail) return NextResponse.json({ read: null, error: "Pick the test's campaigns first, so there's something to read." }, { status: 400 })
  try {
    // Access was checked above with the user's client; the admin client only writes test_reads.
    const read = await writeTestRead(createAdminClient(), { test: test as SprintTest, clientId: client.id, currency: client.currency, detail, today, requestedBy: me.id })
    return NextResponse.json({ read })
  } catch (e) {
    console.error("test read failed", e)
    return NextResponse.json({ read: stored ?? null, error: "Claude couldn't read this test just now. Try again in a minute." }, { status: 502 })
  }
}
