import { notFound } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import type { Platform } from "@/lib/metrics/types"
import { previewsFor, adKey, type Preview } from "@/lib/previews"
import { createAdminClient } from "@/lib/supabase/admin"
import { WeeklyReadPrototype } from "./weekly-read"

// Development-only prototype of the weekly read, Overall and ABX, on sample data (like /design). The
// numbers are made up; the ad previews borrow real Camber creatives from storage so the thumbnails look
// like the real thing (localhost only, nothing is stored). Camber's document ads only have LinkedIn's
// generic document tile, so the "doc" slots borrow single image creatives too.
const SLOTS: { prefixes: [string, number][]; platform: Platform; type: string | null }[] = [
  { prefixes: [["doc", 8], ["img", 4]], platform: "linkedin", type: "STANDARD" },
  { prefixes: [["meta", 4]], platform: "meta", type: null },
  { prefixes: [["search", 2]], platform: "google_ads", type: "RESPONSIVE_SEARCH_AD" },
]

async function samplePreviews(clientId: string): Promise<Record<string, Preview>> {
  const db = createAdminClient()
  const out: Record<string, Preview> = {}
  for (const s of SLOTS) {
    const search = s.platform === "google_ads"
    let q = db.from("ad_creatives").select("platform, external_account_id, ad_id, source_url").eq("client_id", clientId).eq("platform", s.platform)
    q = s.type ? q.eq("ad_type", s.type) : q.is("ad_type", null)
    q = search ? q.not("text_ad", "is", null) : q.not("storage_path", "is", null)
    const { data } = await q.order("seen_at", { ascending: false }).limit(100)
    // One row per image: the same creative often runs as several ads.
    const seen = new Set<string>()
    const rows = (data ?? []).filter((r) => {
      const k = search ? r.ad_id : (r.source_url ?? r.ad_id).split("?")[0]
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const previews = await previewsFor(db, clientId, rows)
    let n = 0
    for (const [prefix, count] of s.prefixes)
      for (let i = 1; i <= count && n < rows.length; i++, n++) {
        const p = previews[adKey(rows[n])]
        if (p) out[`${prefix}-${i}`] = { ...p, addPost: null }
      }
  }
  return out
}

export default async function WeeklyReadPreview() {
  if (process.env.NODE_ENV !== "development") notFound()
  const { data: clients } = await createAdminClient().from("clients").select("id, slug, name, logo_url").order("name")
  const camber = clients?.find((c) => c.slug === "camber")
  const previews = camber ? await samplePreviews(camber.id) : {}
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <AppSidebar clients={clients ?? []} name="Dean Steinhobel" roleLabel="Admin" isAdmin hasRole profileId="sample" avatarUrl={null} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 lg:py-10">
          <WeeklyReadPrototype client="Camber" logoUrl={camber?.logo_url ?? null} previews={previews} />
        </div>
      </main>
    </div>
  )
}
