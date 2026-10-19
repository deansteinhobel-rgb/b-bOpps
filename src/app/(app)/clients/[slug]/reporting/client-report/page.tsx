import { notFound } from "next/navigation"
import { SectionHeader } from "@/components/page-header"
import { shortDate } from "@/lib/format"
import { decodeRange, parseRange, rangeLabel } from "@/lib/metrics/range"
import { createClient } from "@/lib/supabase/server"
import type { EmbedLink } from "../embed-button"
import { ClientReportView } from "./client-report-view"
import { campaignValue, loadClientReport, parseCampaignStep, parsePlatformStep } from "./data"
import { ReportBuilder } from "./report-builder"
import { ShareReport } from "./share-report"

export const metadata = { title: "Client report" }

/**
 * Client report (Dean, 2026-10-19): Reporting › Client report. Three questions (platform, campaign,
 * dates), then the report as the client will see it, and "Share with the client" for a view-only
 * link (the same secret links as the Notion embeds, /embed/report/<token>).
 */
export default async function ClientReportPage({ params, searchParams }: PageProps<"/clients/[slug]/reporting/client-report">) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("id, name, logo_url, currency, monthly_kpi_target").eq("slug", slug).maybeSingle()
  if (!client) notFound()
  // Access confirmed above (client loaded through RLS), so the shared caches are safe to use.

  const range = parseRange(sp, 30)
  const platformStep = parsePlatformStep(sp.platform)
  const campaignStep = platformStep ? parseCampaignStep(sp.campaign) : null
  // A campaign from another platform than the one picked (an edited URL) counts as not picked yet.
  const camp = campaignStep && campaignStep !== "all" && (platformStep === "all" || campaignStep.platform === platformStep) ? campaignStep : null
  const answered = campaignStep === "all" || camp !== null
  const platform = platformStep && platformStep !== "all" ? platformStep : null

  const data = await loadClientReport(supabase, client, { platform, campaign: camp }, range)
  if (!data) return <p className="text-muted-foreground">No ad data yet. An admin can run a Windsor backfill for this client.</p>
  const campaignName = camp ? (data.campaigns.find((c) => c.value === campaignValue(camp))?.name ?? data.title) : null

  // The links already made for this exact report (platform and campaign).
  const sharePlatform = camp?.platform ?? platform ?? "all"
  const [{ data: links }, { data: canShare }] = answered
    ? await Promise.all([
        // "*": works before and after migration 20261019000077 adds `kind` and `campaign_id`.
        supabase.from("report_links").select("*").eq("client_id", client.id).eq("board", sharePlatform).is("revoked_at", null).order("created_at", { ascending: false }),
        supabase.rpc("can_share_reports", { cid: client.id }),
      ])
    : [{ data: [] }, { data: false }]
  const mine = (links ?? []).filter((l) => l.kind === "client_report" && (l.campaign_id ?? null) === (camp?.id ?? null))
  const creators = [...new Set(mine.map((l) => l.created_by_profile_id).filter(Boolean))] as string[]
  const { data: people } = creators.length ? await supabase.from("profiles").select("id, full_name, email").in("id", creators) : { data: [] }
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name ?? p.email]))
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
  const linkViews: EmbedLink[] = mine.map((l) => ({
    id: l.id,
    board: l.board,
    opens: rangeLabel(decodeRange(l.default_range) ?? { kind: "days", days: l.default_days }),
    label: l.label,
    url: `${appUrl}/embed/report/${l.token}`,
    created: `${shortDate(l.created_at.slice(0, 10))}${nameOf.get(l.created_by_profile_id) ? ` by ${nameOf.get(l.created_by_profile_id)}` : ""}`,
    lastViewed: l.last_viewed_at ? shortDate(l.last_viewed_at.slice(0, 10)) : null,
  }))

  return (
    <div className="space-y-6">
      <SectionHeader title="Client report" description="Answer three questions and the report builds itself, written for the client. Share it as a view-only link." />
      <ReportBuilder
        platform={platformStep}
        campaign={campaignStep === "all" ? "all" : camp ? campaignValue(camp) : null}
        campaignName={campaignName}
        range={range}
        periods={data.periods}
        dataFrom={data.dataFrom}
        dataThrough={data.dataThrough}
        platforms={data.platforms}
        campaigns={data.campaigns}
        currency={client.currency}
      />
      {answered && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">This is what the client sees. Data through {shortDate(data.dataThrough)}, updated daily.</p>
            <ShareReport slug={slug} platform={sharePlatform} campaign={camp?.id ?? null} title={data.title} range={range} links={linkViews} canShare={Boolean(canShare)} />
          </div>
          <ClientReportView data={data} client={{ name: client.name, logoUrl: client.logo_url }} currency={client.currency} />
        </div>
      )}
    </div>
  )
}
