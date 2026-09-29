"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile, isAdmin } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

// Profiles (Dean, 2026-09-29). People edit their own details; admins can edit anyone's. Role, email
// and Notion user stay admin-only (Admin → People, and a database guard). Nothing is deleted.

export type ProfileResult = { ok: boolean; message?: string }
const fail = (message: string): ProfileResult => ({ ok: false, message })

const Details = z.object({
  full_name: z.string().trim().min(1, "Add your name.").max(120),
  job_title: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  location: z.string().trim().max(120),
  timezone: z.string().trim().max(60),
  bio: z.string().trim().max(1000),
})

async function allowed(profileId: string) {
  const me = await getProfile()
  return me.id === profileId || isAdmin(me)
}

export async function updateProfile(profileId: string, raw: z.input<typeof Details>): Promise<ProfileResult> {
  if (!(await allowed(profileId))) return fail("You can only edit your own profile.")
  const p = Details.safeParse(raw)
  if (!p.success) return fail(p.error.issues[0].message)
  if (p.data.timezone && !Intl.supportedValuesOf("timeZone").includes(p.data.timezone)) return fail("Pick a time zone from the list.")
  const supabase = await createClient()
  const { error } = await supabase
    .from("profiles")
    .update({ ...p.data, job_title: p.data.job_title || null, phone: p.data.phone || null, location: p.data.location || null, bio: p.data.bio || null, timezone: p.data.timezone || "Europe/London" })
    .eq("id", profileId)
  if (error) return fail("Couldn't save.")
  revalidatePath(`/people/${profileId}`)
  revalidatePath("/", "layout")
  return { ok: true }
}

/**
 * A new profile picture. The browser shrinks it to a 256px square WebP first (well under the 1 MB
 * server action limit). Stored in the public "avatars" bucket at <profile id>/<time>.webp; older
 * pictures are left in place (no deletes).
 */
export async function uploadAvatar(profileId: string, form: FormData): Promise<ProfileResult> {
  if (!(await allowed(profileId))) return fail("You can only change your own picture.")
  const file = form.get("file")
  if (!(file instanceof File) || !file.size) return fail("Pick an image.")
  if (file.size > 900_000 || !["image/webp", "image/png", "image/jpeg"].includes(file.type)) return fail("Use a JPG, PNG or WebP image.")
  const limited = await rateLimit(await createClient(), "avatar_upload")
  if (limited) return fail(limited)
  const path = `${profileId}/${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp"}`
  const admin = createAdminClient()
  const { error } = await admin.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: false })
  if (error) return fail("Couldn't upload the picture.")
  const url = admin.storage.from("avatars").getPublicUrl(path).data.publicUrl
  const supabase = await createClient()
  const { error: upErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profileId)
  if (upErr) return fail("Couldn't save the picture.")
  revalidatePath(`/people/${profileId}`)
  revalidatePath("/", "layout")
  return { ok: true }
}

/** Back to initials. The old file stays in storage. */
export async function removeAvatar(profileId: string): Promise<ProfileResult> {
  if (!(await allowed(profileId))) return fail("You can only change your own picture.")
  const supabase = await createClient()
  await supabase.from("profiles").update({ avatar_url: null }).eq("id", profileId)
  revalidatePath(`/people/${profileId}`)
  revalidatePath("/", "layout")
  return { ok: true }
}
