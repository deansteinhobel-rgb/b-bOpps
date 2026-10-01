"use server"

import { z } from "zod"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { copyPostImage, linkedInPostLink } from "@/lib/windsor/creatives"

const Input = z.object({ clientId: z.uuid(), key: z.string().max(200), link: z.string().max(500) })

/**
 * "Add the post link" on a LinkedIn ad tile (Dean, 2026-10-01): thought leader ads come from Windsor
 * with no post link or image. Stores the link apart from Windsor's (the sync never overwrites it),
 * then copies the image from the public post page. Our database and storage only.
 */
export async function addAdPostLink(input: { clientId: string; key: string; link: string }): Promise<{ ok: boolean; message: string }> {
  const me = await getProfile()
  if (!canEdit(me)) return { ok: false, message: VIEW_ONLY }
  const parsed = Input.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Something was missing. Refresh and try again." }
  const [platform, accountId, adId] = parsed.data.key.split("|")
  if (platform !== "linkedin" || !accountId || !adId) return { ok: false, message: "Post links are for LinkedIn ads only." }
  const link = linkedInPostLink(parsed.data.link)
  if (!link) return { ok: false, message: "That isn't a LinkedIn post link. Open the post, use \"Copy link to post\" and paste it here." }

  // The caller's client: RLS confirms they can see this client's ad, and can edit the client.
  const supabase = await createClient()
  const [{ data: row }, { data: editable }] = await Promise.all([
    supabase.from("ad_creatives").select("id").eq("client_id", parsed.data.clientId).eq("platform", "linkedin").eq("external_account_id", accountId).eq("ad_id", adId).maybeSingle(),
    supabase.rpc("can_edit_client", { cid: parsed.data.clientId }),
  ])
  if (!row || !editable) return { ok: false, message: "You can't change this ad." }

  const { error } = await createAdminClient()
    .from("ad_creatives")
    .update({ manual_post_link: link, manual_post_link_by: me.id, manual_post_link_at: new Date().toISOString(), copy_error: null })
    .eq("id", row.id)
  if (error) return { ok: false, message: "Couldn't save the link." }

  const image = await copyPostImage(row.id, link, `${parsed.data.clientId}/linkedin/${adId.replace(/[^a-zA-Z0-9_-]/g, "_")}`)
  return image.ok ? { ok: true, message: "Post linked, with its image." } : { ok: true, message: "Post linked. LinkedIn didn't share the image (the post may be private)." }
}
