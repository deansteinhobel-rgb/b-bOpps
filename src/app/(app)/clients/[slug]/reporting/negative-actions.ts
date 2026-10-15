"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getProfile } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"
import { canPushNegatives } from "@/lib/windsor/access"
import { pushDeps } from "@/lib/windsor/mcp"
import { negativeBlocks } from "@/lib/insights/term-review-rules"
import { cleanTerm, MATCH_TYPES, pushNegativeKeywords, type PushResult } from "@/lib/windsor/negatives"

const Input = z.object({
  clientSlug: z.string().min(1),
  campaignId: z.string().regex(/^\d{1,20}$/),
  level: z.enum(["ad_group", "campaign"]),
  matchType: z.enum(MATCH_TYPES),
  terms: z.array(z.object({ text: z.string().min(1).max(200), adGroupId: z.string().max(30) })).min(1).max(2000),
})

/** Add search terms as negative keywords in Google Ads, through Windsor. Dry run until Dean switches it on. */
export async function pushNegatives(raw: z.input<typeof Input>): Promise<PushResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { ok: false, live: false, pushes: [], error: "Pick the search terms to add." }
  const { clientSlug, campaignId, level, matchType, terms } = parsed.data
  const me = await getProfile()
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, slug").eq("slug", clientSlug).maybeSingle()
  if (!client) return { ok: false, live: false, pushes: [], error: "This client isn't available to you." }
  if (!(await canPushNegatives(me, client.id))) return { ok: false, live: false, pushes: [], error: "You can't add negatives for this client." }

  // The campaign's Google Ads account and ad groups come from our own data, never from the browser.
  const { data: seen } = await supabase
    .from("windsor_breakdowns")
    .select("external_account_id, group_id")
    .eq("client_id", client.id)
    .eq("kind", "search_term")
    .eq("campaign_id", campaignId)
    .order("date", { ascending: false })
    .limit(1000)
  const accountIds = [...new Set((seen ?? []).map((r) => String(r.external_account_id)))]
  if (accountIds.length !== 1) return { ok: false, live: false, pushes: [], error: "Couldn't tell which Google Ads account this campaign is in." }
  const accountId = accountIds[0]
  const { data: mapped } = await supabase.from("client_platform_accounts").select("external_account_id").eq("client_id", client.id).eq("platform", "google_ads").eq("external_account_id", accountId).limit(1)
  if (!(mapped ?? []).length) return { ok: false, live: false, pushes: [], error: "That Google Ads account isn't mapped to this client." }
  if (level === "ad_group") {
    const groups = new Set((seen ?? []).map((r) => String(r.group_id)))
    if (terms.some((t) => !groups.has(t.adGroupId))) return { ok: false, live: false, pushes: [], error: "One of the ad groups isn't in this campaign. Refresh the page and try again." }
  }

  // The safety check runs here too, not only in the browser (Aikido, access control): no negative may
  // block a different search in this campaign that converted (last 90 days).
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
  const { data: converting } = await supabase
    .from("windsor_breakdowns")
    .select("dim1")
    .eq("client_id", client.id)
    .eq("kind", "search_term")
    .eq("campaign_id", campaignId)
    .gt("conversions", 0)
    .gte("date", since)
    .limit(5000)
  const converted = [...new Set((converting ?? []).map((r) => cleanTerm(r.dim1)))]
  for (const t of terms) {
    const own = cleanTerm(t.text)
    const hit = converted.find((c) => c !== own && negativeBlocks(own, matchType, c))
    if (hit) return { ok: false, live: false, pushes: [], error: `"${t.text}" (${matchType.toLowerCase()}) would also block "${hit}", which converted. Use exact match, or leave it out.` }
  }

  const limited = await rateLimit(supabase, "negative_push")
  if (limited) return { ok: false, live: false, pushes: [], error: limited }

  const result = await pushNegativeKeywords(pushDeps(), { client, accountId, campaignId, level, matchType, terms, by: { id: me.id } })
  revalidatePath(`/clients/${clientSlug}/reporting/google_ads/${campaignId}`)
  return result
}
