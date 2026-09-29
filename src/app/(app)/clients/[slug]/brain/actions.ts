"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { getProfile, isAdmin } from "@/lib/auth"
import { FILE_BUCKET } from "@/lib/knowledge/brief"
import { readHqPage } from "@/lib/knowledge/notion-hq"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

// The Client brain. Notes and brief corrections go through the user's own client (RLS: the
// client's team). Files and the HQ page picker use the server client after an access check.
// Nothing is deleted: removing sets removed_at. Notion is only ever read.

export type BrainResult = { ok: boolean; message?: string }
const fail = (message: string): BrainResult => ({ ok: false, message })
const refresh = (slug: string) => revalidatePath(`/clients/${slug}/brain`)
const CATEGORIES = ["target", "constraint", "note"]
const FILE_TYPES: Record<string, string> = { "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md", "text/csv": "csv" }

async function clientFor(slug: string) {
  const supabase = await createClient()
  const { data } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  return { supabase, clientId: data?.id as string | undefined }
}

export async function addNote(slug: string, category: string, text: string): Promise<BrainResult> {
  const me = await getProfile()
  const content = text.trim()
  if (!content) return fail("Write the note first.")
  if (content.length > 1000) return fail("Keep it under 1,000 characters. Upload a file for longer material.")
  if (!CATEGORIES.includes(category)) return fail("Pick a type.")
  const { supabase, clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const { error } = await supabase.from("client_knowledge").insert({ client_id: clientId, source: "note", category, title: content.slice(0, 80), content, content_chars: content.length, created_by_profile_id: me.id })
  if (error) return fail("Couldn't save the note.")
  refresh(slug)
  return { ok: true }
}

export async function removeNote(slug: string, id: string): Promise<BrainResult> {
  const { supabase } = await clientFor(slug)
  const { error } = await supabase.from("client_knowledge").update({ removed_at: new Date().toISOString() }).eq("id", id).eq("source", "note")
  if (error) return fail("Couldn't remove it.")
  refresh(slug)
  return { ok: true }
}

/**
 * Uploads go straight from the browser to storage with a one-time signed link (Vercel limits
 * request bodies to 4.5 MB), then finishUpload records them. Both check access first.
 */
export async function startUpload(slug: string, name: string, type: string, size: number): Promise<BrainResult & { path?: string; token?: string }> {
  if (!FILE_TYPES[type]) return fail("PDF, TXT, MD or CSV only.")
  if (size > 10 * 1024 * 1024) return fail("Files must be under 10 MB.")
  const { clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const path = `${clientId}/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)}`
  const { data, error } = await createAdminClient().storage.from(FILE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return fail("Couldn't start the upload.")
  return { ok: true, path, token: data.token }
}

export async function finishUpload(slug: string, path: string, name: string, type: string, size: number): Promise<BrainResult> {
  const me = await getProfile()
  const { clientId } = await clientFor(slug)
  if (!clientId || !path.startsWith(`${clientId}/`) || !FILE_TYPES[type]) return fail("This upload isn't available to you.")
  const db = createAdminClient()
  const folder = path.slice(0, path.lastIndexOf("/"))
  const { data: found } = await db.storage.from(FILE_BUCKET).list(folder, { search: path.slice(path.lastIndexOf("/") + 1) })
  if (!found?.length) return fail("The upload didn't arrive. Try again.")
  const { error } = await db.from("client_knowledge").insert({ client_id: clientId, source: "file", title: name.slice(0, 200), file_path: path, file_type: type, content_chars: size, created_by_profile_id: me.id })
  if (error) return fail("Uploaded, but couldn't record it.")
  refresh(slug)
  return { ok: true }
}

export async function removeFile(slug: string, id: string): Promise<BrainResult> {
  const { clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  // The stored file stays (no deletes); it just stops counting.
  const { error } = await createAdminClient().from("client_knowledge").update({ removed_at: new Date().toISOString() }).eq("id", id).eq("client_id", clientId).eq("source", "file")
  if (error) return fail("Couldn't remove it.")
  refresh(slug)
  return { ok: true }
}

/** Tick or untick an HQ page. Ticking reads it straight away (read only). GTM leads and admins. */
export async function setHqPageIncluded(slug: string, id: string, include: boolean): Promise<BrainResult> {
  const me = await getProfile()
  if (!isAdmin(me)) return fail("Only GTM leads and admins choose which HQ pages count.")
  const { clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const db = createAdminClient()
  const { data: row, error } = await db.from("client_knowledge").update({ include, updated_at: new Date().toISOString() }).eq("id", id).eq("client_id", clientId).eq("source", "notion").select("content").single()
  if (error) return fail("Couldn't save.")
  if (include && !row?.content) after(() => readHqPage(id))
  refresh(slug)
  return { ok: true, message: include && !row?.content ? "Reading it from Notion now." : undefined }
}

/** Save the team's corrected brief as a new version. Claude keeps these corrections next time. */
export async function saveBriefEdit(slug: string, content: string): Promise<BrainResult> {
  const me = await getProfile()
  const text = content.trim()
  if (text.length < 50) return fail("That looks too short to be the brief.")
  const { supabase, clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const { error } = await supabase.from("client_briefs").insert({ client_id: clientId, status: "ready", written_by: "person", content: text.slice(0, 30_000), created_by_profile_id: me.id, finished_at: new Date().toISOString() })
  if (error) return fail("Couldn't save the brief.")
  refresh(slug)
  return { ok: true }
}
