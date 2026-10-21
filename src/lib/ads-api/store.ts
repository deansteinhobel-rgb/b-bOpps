import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { toJson } from "@/lib/supabase/db"
import type { BuildStore } from "./build"

/** The runner's database calls, with the admin client (builds and the write log are server-written), as `actorId` for the change log. */
export function buildStore(actorId?: string): BuildStore {
  const db = createAdminClient(actorId)
  return {
    async claim(buildId) {
      const { data } = await db
        .from("campaign_builds")
        .update({ status: "sending", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", buildId)
        .in("status", ["draft", "failed", "partly_created"])
        .select("id")
      return (data ?? []).length === 1
    },
    async log(row) {
      const { data, error } = await db
        .from("platform_write_log")
        .insert({ ...row, payload: toJson(row.payload) })
        .select("id")
        .single()
      if (error?.code === "23505") return { duplicate: true }
      if (error || !data) return { error: error?.message ?? "no row" }
      return { id: data.id }
    },
    async finishLog(id, { success, response, ad_id, clearKey }) {
      await db
        .from("platform_write_log")
        .update({ success, response: toJson(response), completed_at: new Date().toISOString(), ...(ad_id ? { ad_id } : {}), ...(clearKey ? { idempotency_key: null } : {}) })
        .eq("id", id)
    },
    async saveBuild(buildId, values) {
      const { created_ids, ...rest } = values
      await db
        .from("campaign_builds")
        .update({ ...rest, ...(created_ids ? { created_ids: toJson(created_ids) } : {}) })
        .eq("id", buildId)
    },
  }
}
