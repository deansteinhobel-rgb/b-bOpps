"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { z } from "zod"
import { getProfile, isAdmin } from "@/lib/auth"
import { windsorTag } from "@/lib/metrics/cached"
import { createClient } from "@/lib/supabase/server"

const Input = z.object({
  clientSlug: z.string().min(1),
  platform: z.enum(["linkedin", "google_ads", "meta"]),
  campaignId: z.string().max(100), // "" = the whole platform
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  amount: z.number().nonnegative().max(100_000_000),
})

/** Set this month's budget for a platform or a campaign. Admins and GTM leads (RLS enforces it too). */
export async function saveMonthBudget(raw: z.input<typeof Input>): Promise<{ ok: boolean; message?: string }> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { ok: false, message: "Enter a budget amount." }
  const me = await getProfile()
  if (!isAdmin(me)) return { ok: false, message: "Only admins and GTM leads can change budgets." }
  const { clientSlug, platform, campaignId, month, amount } = parsed.data
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id").eq("slug", clientSlug).maybeSingle()
  if (!client) return { ok: false, message: "This client isn't available to you." }
  const { error } = await supabase
    .from("client_budgets")
    .upsert({ client_id: client.id, platform, campaign_id: campaignId, month, amount }, { onConflict: "client_id,platform,campaign_id,month" })
  if (error) return { ok: false, message: "Couldn't save the budget." }
  revalidateTag(windsorTag(client.id), { expire: 0 })
  revalidatePath(`/clients/${clientSlug}`, "layout")
  return { ok: true }
}
