"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth"
import { sendWeeklySnapshot } from "@/lib/reports/send"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/** Admin → Slack: send last week's snapshot for one client now, as a test (never counts as the week's post). */
export async function sendSnapshotNow(clientId: string): Promise<{ ok: boolean; message: string }> {
  const me = await requireAdmin()
  // Access through RLS first (admins see every client), then the server writes the log.
  const { data: client } = await (await createClient()).from("clients").select("id").eq("id", clientId).maybeSingle()
  if (!client) return { ok: false, message: "No such client." }
  const r = await sendWeeklySnapshot(createAdminClient(), client.id, { manual: true, by: me.id })
  revalidatePath("/admin/slack")
  if (r.status === "sent") return { ok: true, message: "Sent to Slack." }
  if (r.status === "dry_run") return { ok: false, message: r.error ?? "Not sent: SLACK_BOT_TOKEN isn't set." }
  return { ok: false, message: r.error ?? "Couldn't send it." }
}
