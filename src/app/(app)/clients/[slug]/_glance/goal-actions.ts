"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile, isAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

// Client goal figures (e.g. DNSFilter's Activated Free Trials). Admins and GTM leads only (checked
// here and by RLS). One figure per goal per month, updated in place as the month goes on; no deletes.

const Input = z.object({
  goalId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  value: z.number().min(0).max(1e9),
  target: z.number().min(0).max(1e9).nullable(),
})

export async function saveGoalValue(slug: string, raw: z.input<typeof Input>): Promise<{ ok: boolean; message?: string }> {
  const me = await getProfile()
  if (!isAdmin(me)) return { ok: false, message: "Only admins and GTM leads can update this." }
  const p = Input.safeParse(raw)
  if (!p.success) return { ok: false, message: "Enter a number." }
  const supabase = await createClient()
  const { data: goal } = await supabase.from("client_goals").select("id, client_id, monthly_target").eq("id", p.data.goalId).maybeSingle()
  if (!goal) return { ok: false, message: "That goal isn't available to you." }
  const { error } = await supabase.from("client_goal_values").upsert(
    {
      goal_id: goal.id,
      client_id: goal.client_id,
      month: p.data.month,
      value: p.data.value,
      target: p.data.target ?? goal.monthly_target,
      updated_by_profile_id: me.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "goal_id,month" },
  )
  if (error) return { ok: false, message: "Couldn't save." }
  revalidatePath(`/clients/${slug}`)
  return { ok: true }
}
