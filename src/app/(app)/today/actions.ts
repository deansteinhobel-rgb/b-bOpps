"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { actOnFollowUp } from "@/lib/calls/actions"
import { logInsight } from "../clients/[slug]/insights/actions"

// Done and Snooze from the Today queue. Each goes through its source's own action (same checks, same
// append-only log), so the queue never has a write path of its own.

const Act = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("insight"), slug: z.string().regex(/^[a-z0-9-]+$/), key: z.string().min(1).max(600) }),
  z.object({ kind: z.literal("call"), id: z.string().uuid() }),
])

export async function queueAct(raw: z.input<typeof Act>, action: "done" | "snoozed"): Promise<{ ok: boolean; message?: string }> {
  if (!canEdit(await getProfile())) return { ok: false, message: VIEW_ONLY }
  const a = Act.safeParse(raw)
  if (!a.success || (action !== "done" && action !== "snoozed")) return { ok: false, message: "That item isn't recognised." }
  const r = a.data.kind === "insight" ? await logInsight(a.data.slug, a.data.key, { action, items: [], days: 7 }) : await actOnFollowUp(a.data.id, { action, days: 7 })
  if (r.ok) revalidatePath("/today")
  return { ok: r.ok, message: r.message }
}
