"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { canEdit, getProfile, VIEW_ONLY } from "@/lib/auth"
import { apifyConfigured } from "@/lib/competitors/apify"
import { checkKeywordRelevance } from "@/lib/competitors/relevance"
import { aiConfigured } from "@/lib/ai/claude"
import { pump, queueWeek } from "@/lib/competitors/sync"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

// Competitor ads. The list goes through the user's own client (RLS: the client's team); removing
// sets removed_at. "Read again" reads anything not read in the last 13 days (a competitor or
// keyword just added) now rather than on Sunday; the Sunday job collects whatever is still running.

export type CompetitorResult = { ok: boolean; message?: string }
const fail = (message: string): CompetitorResult => ({ ok: false, message })
const refresh = (slug: string) => revalidatePath(`/clients/${slug}/competitors`)

export type CompetitorInput = { name: string; website: string; metaPageId: string; linkedinAdvertiser: string; googleAdvertiserIds: string; notes: string }

async function clientFor(slug: string) {
  const supabase = await createClient()
  const { data } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle()
  return { supabase, clientId: data?.id }
}

/** The form's text, checked: ids are what the libraries use, so a typo fails here, not on Sunday. */
function clean(input: CompetitorInput): { error: string } | { row: { name: string; website: string | null; meta_page_id: string | null; linkedin_advertiser: string | null; google_advertiser_ids: string[]; notes: string | null } } {
  const name = input.name.trim()
  if (!name) return { error: "Give the competitor a name." }
  if (name.length > 120) return { error: "Keep the name under 120 characters." }
  const meta = input.metaPageId.trim() || null
  if (meta && !/^\d{3,30}$/.test(meta)) return { error: "The Meta page id is a number, e.g. 92466435431 (view_all_page_id in an Ad Library link)." }
  const google = [...new Set(input.googleAdvertiserIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))]
  if (google.some((g) => !/^AR\d{10,30}$/.test(g))) return { error: "Google advertiser ids start with AR, e.g. AR17533550876013101057 (in an Ads Transparency Center link)." }
  if (google.length > 10) return { error: "Ten Google advertiser ids at most." }
  const linkedin = input.linkedinAdvertiser.trim() || null
  if (linkedin && linkedin.length > 120) return { error: "Keep the LinkedIn advertiser name under 120 characters." }
  const website = input.website.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "") || null
  if (website && website.length > 300) return { error: "That website is too long." }
  const notes = input.notes.trim() || null
  if (notes && notes.length > 1000) return { error: "Keep notes under 1,000 characters." }
  return { row: { name, website, meta_page_id: meta, linkedin_advertiser: linkedin, google_advertiser_ids: google, notes } }
}

export async function saveCompetitor(slug: string, id: string | null, input: CompetitorInput): Promise<CompetitorResult> {
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY)
  const c = clean(input)
  if ("error" in c) return fail(c.error)
  const { supabase, clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const limited = await rateLimit(supabase, "competitor_edit")
  if (limited) return fail(limited)
  const { error } = id
    ? await supabase.from("client_competitors").update(c.row).eq("id", id).eq("client_id", clientId).is("removed_at", null)
    : await supabase.from("client_competitors").insert({ ...c.row, client_id: clientId, created_by_profile_id: me.id })
  if (error) return fail("Couldn't save the competitor.")
  refresh(slug)
  return { ok: true }
}

export async function removeCompetitor(slug: string, id: string): Promise<CompetitorResult> {
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY)
  const { supabase, clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const { error } = await supabase
    .from("client_competitors")
    .update({ removed_at: new Date().toISOString(), removed_by_profile_id: me.id })
    .eq("id", id)
    .eq("client_id", clientId)
    .is("removed_at", null)
  if (error) return fail("Couldn't remove it.")
  refresh(slug)
  return { ok: true }
}

/** Reads the libraries again now, rather than waiting for Sunday. Runs take a few minutes. */
export async function readAgain(slug: string): Promise<CompetitorResult & { queued?: number }> {
  if (!canEdit(await getProfile())) return fail(VIEW_ONLY)
  if (!apifyConfigured()) return fail("APIFY_TOKEN isn't set, so the ad libraries can't be read.")
  const { supabase, clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const limited = await rateLimit(supabase, "competitor_refresh")
  if (limited) return fail(limited)
  const { queued } = await queueWeek({ clientId })
  // Start and collect in the background; anything still running is picked up by the next pass.
  after(async () => {
    const stopAt = Date.now() + 240_000
    while (Date.now() < stopAt) {
      const r = await pump({ clientId, stopAt })
      if (!r.open) break
      await new Promise((res) => setTimeout(res, 20_000))
    }
    // New keyword results get their relevance check now rather than at the next labels run.
    if (aiConfigured() && Date.now() < stopAt) await checkKeywordRelevance(clientId, { stopAt: stopAt + 50_000 })
  })
  return { ok: true, queued }
}

/** Adds a keyword to search Meta's and LinkedIn's ad libraries for (read on Sunday, or with Read again). */
export async function addKeyword(slug: string, keyword: string, sources: string[]): Promise<CompetitorResult> {
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY)
  const text = keyword.trim().replace(/\s+/g, " ")
  if (text.length < 2) return fail("Write the keyword first.")
  if (text.length > 80) return fail("Keep the keyword under 80 characters.")
  const picked = [...new Set(sources)].filter((s) => s === "meta" || s === "linkedin")
  if (!picked.length) return fail("Pick Meta, LinkedIn or both.")
  const { supabase, clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const limited = await rateLimit(supabase, "competitor_edit")
  if (limited) return fail(limited)
  const { error } = await supabase.from("competitor_keywords").insert({ client_id: clientId, keyword: text, sources: picked, created_by_profile_id: me.id })
  if (error) return fail(error.code === "23505" ? "That keyword is already on the list." : "Couldn't add the keyword.")
  revalidatePath(`/clients/${slug}/keyword-ads`)
  return { ok: true }
}

export async function removeKeyword(slug: string, id: string): Promise<CompetitorResult> {
  const me = await getProfile()
  if (!canEdit(me)) return fail(VIEW_ONLY)
  const { supabase, clientId } = await clientFor(slug)
  if (!clientId) return fail("This client isn't available to you.")
  const { error } = await supabase
    .from("competitor_keywords")
    .update({ removed_at: new Date().toISOString(), removed_by_profile_id: me.id })
    .eq("id", id)
    .eq("client_id", clientId)
    .is("removed_at", null)
  if (error) return fail("Couldn't remove it.")
  revalidatePath(`/clients/${slug}/keyword-ads`)
  return { ok: true }
}
