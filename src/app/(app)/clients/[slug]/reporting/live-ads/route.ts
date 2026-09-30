import { NextResponse } from "next/server"
import { getProfile } from "@/lib/auth"
import { currencySymbol } from "@/lib/format"
import { addDays } from "@/lib/metrics/ads"
import { cachedOverview } from "@/lib/metrics/cached"
import { isAbx, liveAdRows, liveAdsCsv, type Creative } from "@/lib/metrics/live-ads-export"
import { adKey, type TextAd } from "@/lib/previews"
import { createClient } from "@/lib/supabase/server"
import { adsForPeriod } from "../boards"

/**
 * Every live ad as a CSV, the last 30 days (Reporting → Ad fatigue → Export). `?abx=1` keeps only
 * ABX / ABM campaigns (Dean, 2026-09-30, for Camber). Read only; the client is loaded through RLS.
 */
export async function GET(request: Request, ctx: RouteContext<"/clients/[slug]/reporting/live-ads">) {
  await getProfile()
  const { slug } = await ctx.params
  const abx = new URL(request.url).searchParams.get("abx") === "1"
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, name, currency").eq("slug", slug).maybeSingle()
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 })
  const o = await cachedOverview(client.id)
  if (!o) return NextResponse.json({ error: "No ad data yet." }, { status: 404 })

  const live = o.liveAds.filter((a) => !abx || isAbx(a.campaign_name))
  const through = o.dataThrough
  const last30 = await adsForPeriod(supabase, client.id, addDays(through, -29), through)
  const creatives = new Map<string, Creative>()
  const ids = [...new Set(live.map((a) => a.ad_id))]
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("ad_creatives").select("platform, external_account_id, ad_id, ad_type, preview_link, text_ad").eq("client_id", client.id).in("ad_id", ids.slice(i, i + 200))
    for (const r of data ?? []) creatives.set(adKey(r), { ad_type: r.ad_type, preview_link: r.preview_link, final_url: (r.text_ad as TextAd | null)?.finalUrl ?? null })
  }

  const csv = liveAdsCsv(liveAdRows(live, last30, creatives, adKey), currencySymbol(client.currency))
  const name = `${slug}-${abx ? "abx-" : ""}live-ads-${through}.csv`
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  })
}
