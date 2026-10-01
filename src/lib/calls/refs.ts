import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Short refs for what was said on client calls, so Claude can say which one a sprint suggestion or
 * content idea follows up (Dean, 2026-10-01: call action items feed sprint and content suggestions).
 * The ref is the item's id prefix; it's resolved within the client only.
 */
export const callRef = (id: string) => `call-${id.slice(0, 8)}`

/** A ref Claude gave back → the item's id, when it's one of this client's open items. */
export async function resolveCallRef(db: SupabaseClient, clientId: string, ref: unknown): Promise<string | null> {
  const m = typeof ref === "string" ? ref.trim().toLowerCase().match(/^call-([0-9a-f]{8})$/) : null
  if (!m) return null
  const { data } = await db.from("call_commitments").select("id").eq("client_id", clientId).is("superseded_at", null).gte("id", `${m[1]}-0000-0000-0000-000000000000`).lte("id", `${m[1]}-ffff-ffff-ffff-ffffffffffff`).limit(2)
  return data?.length === 1 ? data[0].id : null
}

/**
 * Marks the call item as planned as a test (the same as "Plan as a sprint test" on the Brain tab),
 * so it stops reminding. `db` is the signed-in user's client (RLS: the client's team).
 */
export async function markCallItemPlanned(db: SupabaseClient, o: { clientId: string; commitmentId: string; testId: string; profileId: string }) {
  await db.from("call_commitment_actions").insert({ client_id: o.clientId, commitment_id: o.commitmentId, action: "planned", sprint_test_id: o.testId, profile_id: o.profileId })
}
