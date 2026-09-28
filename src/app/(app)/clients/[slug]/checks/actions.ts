"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { buildAutoData } from "@/lib/checks/auto-data"
import { weekOf } from "@/lib/checks/periods"
import { cachedOverview } from "@/lib/metrics/cached"
import { createClient } from "@/lib/supabase/server"

const Input = z.object({
  resultId: z.string().uuid(),
  status: z.enum(["green", "amber", "red", "na"]),
  findings: z.string().trim().max(5000).optional().default(""),
  flaggedTo: z.string().uuid().nullable().optional(),
})

export type SaveState = { ok: boolean; message?: string; savedAt?: string }

export async function saveCheckResult(input: z.input<typeof Input>): Promise<SaveState> {
  const parsed = Input.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Pick a status before saving." }
  const { resultId, status, findings, flaggedTo } = parsed.data
  if (status === "red" && !findings) return { ok: false, message: "Add findings for a red check. They pre-fill the Notion action." }

  const me = await getProfile()
  const supabase = await createClient()
  // RLS: only returns the result if the user is on this client's team (or an admin).
  const { data: current } = await supabase
    .from("check_results")
    .select("id, client_id, flagged_to_profile_id, flagged_at, check_definitions(key), check_runs(period_start), clients(slug, currency, monthly_kpi_target)")
    .eq("id", resultId)
    .single()
  if (!current) return { ok: false, message: "This check isn't available to you." }

  if (flaggedTo) {
    const { data: person } = await supabase.from("profiles").select("id").eq("id", flaggedTo).not("role", "is", null).maybeSingle()
    if (!person) return { ok: false, message: "That person can't be flagged." }
  }

  // Snapshot the pre-loaded numbers as they are now, computed on the server.
  const def = current.check_definitions as unknown as { key: string }
  const run = current.check_runs as unknown as { period_start: string }
  const client = current.clients as unknown as { slug: string; currency: string; monthly_kpi_target: number | null }
  // Access already confirmed: `current` was loaded through RLS.
  const overview = await cachedOverview(current.client_id)
  const autoData = overview
    ? buildAutoData(def.key, overview, {
        currency: client.currency,
        target: client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target),
        weekStart: weekOf(run.period_start).start,
      })
    : null

  const now = new Date().toISOString()
  const flagChanged = (flaggedTo ?? null) !== current.flagged_to_profile_id
  const { error } = await supabase
    .from("check_results")
    .update({
      status,
      findings: findings || null,
      flagged_to_profile_id: flaggedTo ?? null,
      flagged_at: flagChanged ? (flaggedTo ? now : null) : current.flagged_at,
      checked_by_profile_id: me.id,
      checked_at: now,
      auto_data: autoData,
    })
    .eq("id", resultId)
  if (error) return { ok: false, message: "Couldn't save. Try again." }

  revalidatePath(`/clients/${client.slug}/checks`)
  return { ok: true, savedAt: now }
}
