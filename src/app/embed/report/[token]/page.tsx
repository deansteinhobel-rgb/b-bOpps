import { longDate } from "@/lib/format"
import { cachedPerformance } from "@/lib/metrics/cached"
import { decodeRange, parseRange } from "@/lib/metrics/range"
import type { Platform } from "@/lib/metrics/types"
import { previewsFor } from "@/lib/previews"
import { createAdminClient } from "@/lib/supabase/admin"
import { adsForPeriod, boardAds, buildBoard, isBoardKey } from "@/app/(app)/clients/[slug]/reporting/boards"
import { ReportBoard } from "@/app/(app)/clients/[slug]/reporting/report-board"
import { PeriodPicker } from "./period-picker"

export const metadata = { title: "Report", robots: { index: false, follow: false } }

/**
 * A client report board for a Notion embed (Dean, 2026-09-29). No sign-in: the secret link is the
 * key. The link row is read with the admin client and decides everything shown: one client, one
 * board. Nothing here links back into the app. Turned-off links show a short notice.
 */
export default async function EmbedReportPage({ params, searchParams }: PageProps<"/embed/report/[token]">) {
  const { token } = await params
  const sp = await searchParams
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return <Notice text="This report link isn't valid." />
  const admin = createAdminClient()
  const { data: link } = await admin.from("report_links").select("id, client_id, board, default_days, default_range, revoked_at, last_viewed_at").eq("token", token).maybeSingle()
  if (!link || link.revoked_at || !isBoardKey(link.board)) return <Notice text="This report link has been turned off. Ask Bordeaux & Burgundy for a new one." />
  const { data: client } = await admin.from("clients").select("name, logo_url, currency").eq("id", link.client_id).maybeSingle()
  if (!client) return <Notice text="This report isn't available." />

  const range = parseRange(sp, decodeRange(link.default_range) ?? link.default_days)
  const platform = link.board === "all" ? null : (link.board as Platform)
  const perf = await cachedPerformance(link.client_id, range, null)
  if (!perf) return <Notice text="No data for this report yet." />
  const { from, to, prevFrom, prevTo, compare } = perf.periods
  const ads = await adsForPeriod(admin, link.client_id, from, to)
  const board = buildBoard(perf, ads, platform)
  const previews = await previewsFor(admin, link.client_id, boardAds([board], ads))

  await markViewed(admin, link)

  return (
    <main className="mx-auto w-full max-w-6xl space-y-3 bg-background p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker range={range} periods={perf.periods} dataFrom={perf.dataFrom} dataThrough={perf.dataThrough} />
        <p className="text-[11px] text-muted-foreground">Data through {longDate(perf.dataThrough)} · updated daily</p>
      </div>
      <ReportBoard board={board} client={{ name: client.name, logoUrl: client.logo_url }} currency={client.currency} from={from} to={to} prevFrom={prevFrom} prevTo={prevTo} compare={compare} latest={perf.dataThrough} previews={previews} />
      <p className="text-center text-[11px] text-subtle-foreground">Report by Bordeaux &amp; Burgundy</p>
    </main>
  )
}

/** When the link was last looked at, for the team (written at most every 10 minutes). */
async function markViewed(admin: ReturnType<typeof createAdminClient>, link: { id: string; last_viewed_at: string | null }) {
  if (link.last_viewed_at && Date.now() - Date.parse(link.last_viewed_at) < 10 * 60000) return
  await admin.from("report_links").update({ last_viewed_at: new Date().toISOString() }).eq("id", link.id)
}

function Notice({ text }: { text: string }) {
  return (
    <main className="flex min-h-[50vh] items-center justify-center bg-background p-6">
      <p className="text-sm text-muted-foreground">{text}</p>
    </main>
  )
}
