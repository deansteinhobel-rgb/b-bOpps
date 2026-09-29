import { notFound } from "next/navigation"
import { AdThumb } from "@/components/ad-thumb"
import { AppSidebar } from "@/components/app-sidebar"
import { ClientLogo, PlatformLabel } from "@/components/brand"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createAdminClient } from "@/lib/supabase/admin"
import { CheckDeck } from "../(app)/clients/[slug]/checks/check-deck"
import { FatiguePanel } from "../(app)/clients/[slug]/fatigue-panel"
import { PacingPanel } from "../(app)/clients/[slug]/pacing-panel"
import { AiPanel } from "../(app)/clients/[slug]/sprint/ai-panel"
import { WinePour } from "@/components/fx/wine-pour"
import { CampaignTable, Investigator, PlatformSplit, TrendPanel } from "../(app)/clients/[slug]/performance/charts"
import { derive } from "@/lib/metrics/performance"
import { CampaignDetailData, LandingPages } from "../(app)/clients/[slug]/performance/breakdowns"
import { adHealth, type FatigueInput } from "@/lib/metrics/ads"
import type { CheckDefinition, CheckResult } from "@/lib/checks/runs"
import { applyActions, computeInsights, type InsightInputs } from "@/lib/insights/rules"
import { InsightFeed } from "../(app)/clients/[slug]/insights/feed"
import type { CampaignPacing, PlatformPacing } from "@/lib/metrics/overview"

const def = (key: string, name: string): CheckDefinition => ({ id: key, key, name, cadence: "weekly", owner_role: "specialist", pre_loaded: null, instructions: "Sample instructions for the design preview.", what_to_record: "What you found", not_applicable_when: null, flag_immediately_when: null, guide: "Green = fine. Amber = watch. Red = act now.", sort_order: 1 })
const res = (id: string, status: CheckResult["status"]): CheckResult => ({ id, check_definition_id: id, status, findings: status ? "Sample findings" : null, flagged_to_profile_id: null, flagged_at: null, checked_by_profile_id: null, checked_at: status ? "2026-09-28T10:00:00Z" : null, notion_action_page_id: null, auto_data: null })
const deckItems = [
  ["budget_pacing", "Budget pacing", "green"],
  ["leads_in_crm", "Leads in CRM", null],
  ["landing_pages", "Landing pages, tags and forms", null],
  ["ad_fatigue", "Ad fatigue", null],
].map(([k, n, st]) => ({
  definition: def(k as string, n as string),
  result: res(`sample-${k}`, st as CheckResult["status"]),
  liveData: null,
  previews: {},
  people: [],
  checkedByName: st ? "Andrea Restrepo" : null,
  flaggedToName: null,
  redNotActioned: false,
  action: { clientSlug: "dnsfilter", live: false, owners: [], defaultOwnerNotionId: null, defaultDue: "2026-10-05", notionUrl: null },
}))
const pp = (platform: PlatformPacing["platform"], spend: number, budget: number, status: PlatformPacing["status"]): PlatformPacing => ({
  platform, spendMtd: spend, budget, budgetSource: "default", dataThrough: "2026-09-27", status, month: "2026-09", daysElapsed: 27, daysInMonth: 30, expected: (budget * 27) / 30, ratio: spend / ((budget * 27) / 30), variancePct: 0, reasons: [],
})
const fi = (id: string, name: string, platform: FatigueInput["platform"], first_seen: string, rc: number, rs: number, rr: number): FatigueInput => ({
  platform, external_account_id: "1", ad_id: id, ad_name: name, campaign_name: "DG | Search | Non-Brand Core", first_seen, data_from: "2026-06-30", data_through: "2026-09-27", live: true,
  recent_impressions: 10000, recent_clicks: rc, recent_spend: rs, recent_conversions: rr, recent_leads: 0,
  early_impressions: 10000, early_clicks: 500, early_spend: 3000, early_conversions: 10, early_leads: 0,
})
const sampleAds = adHealth([
  fi("a", "DNS Filtering Service | Cloud DNS Filter", "google_ads", "2026-08-03", 416, 6910, 22),
  fi("b", "Single Image #1b - High Intent Form", "meta", "2026-08-24", 560, 1616, 8),
  fi("c", "Carousel - Protective DNS for MSPs", "linkedin", "2026-09-05", 520, 900, 3),
  fi("d", "Single Image #1 - The AI Arms Race", "meta", "2026-09-21", 500, 679, 2),
  fi("e", "Brand | DNSFilter", "google_ads", "2026-06-30", 700, 400, 0),
])
// Synthetic performance data (no client numbers on this unauthenticated page).
const wave = (i: number, base: number, amp: number) => Math.max(0, base + amp * Math.sin(i / 3) + ((i * 37) % 11) - 5)
const perfDaily = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, ...derive({ spend: wave(i, 900, 250), impressions: wave(i, 30000, 9000), clicks: wave(i, 420, 120), conversions: wave(i, 6, 3), leads: wave(i, 3, 2) }) }))
const perfPrev = perfDaily.map((d, i) => ({ ...d, date: `2026-08-${String(i + 1).padStart(2, "0")}`, ...derive({ spend: wave(i + 5, 780, 200), impressions: wave(i + 5, 22000, 7000), clicks: wave(i + 5, 380, 100), conversions: wave(i + 5, 5, 2), leads: wave(i + 5, 2, 1) }) }))
const sumD = (list: typeof perfDaily) => derive(list.reduce((s, d) => ({ spend: s.spend + d.spend, impressions: s.impressions + d.impressions, clicks: s.clicks + d.clicks, conversions: s.conversions + d.conversions, leads: s.leads + d.leads }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0 }))
const perfNow = sumD(perfDaily)
const perfBefore = sumD(perfPrev)
const perfCampaigns = [
  { platform: "google_ads" as const, campaignId: "1", name: "DG | Search | Non-Brand Core", now: derive({ spend: 12400, impressions: 380000, clicks: 6100, conversions: 41, leads: 0 }), prev: derive({ spend: 10100, impressions: 300000, clicks: 5200, conversions: 38, leads: 0 }), daily: perfDaily.map((d) => ({ date: d.date, spend: d.spend * 0.5, results: d.results })), live: true },
  { platform: "linkedin" as const, campaignId: "2", name: "LI | Cold | Buying committee | 3 months free", now: derive({ spend: 3800, impressions: 71000, clicks: 330, conversions: 2, leads: 5 }), prev: derive({ spend: 3200, impressions: 60000, clicks: 390, conversions: 4, leads: 6 }), daily: perfDaily.map((d) => ({ date: d.date, spend: d.spend * 0.2, results: d.results })), live: true },
  { platform: "meta" as const, campaignId: "3", name: "Meta | Remarketing | Static", now: derive({ spend: 3967, impressions: 28900, clicks: 414, conversions: 20, leads: 23 }), prev: derive({ spend: 1552, impressions: 13900, clicks: 303, conversions: 2, leads: 4 }), daily: perfDaily.map((d) => ({ date: d.date, spend: d.spend * 0.15, results: d.results })), live: false },
]
const bd = (dim1: string, dim2: string, spend: number, impressions: number, clicks: number, conversions: number, extra: Record<string, unknown> | null = null) => ({ campaignId: "1", groupId: "g", groupName: "Ad group", dim1, dim2, days: 30, extra, m: derive({ spend, impressions, clicks, conversions, leads: 0 }) })
const sampleGoogle = {
  kind: "google" as const,
  terms: [
    { ...bd("dns filtering service", "EXACT", 1800, 9000, 520, 9), isKeyword: true },
    { ...bd("free dns filter for home", "BROAD", 700, 5200, 210, 0), isKeyword: false },
    { ...bd("best dns filter for msp", "PHRASE", 420, 1900, 95, 3), isKeyword: false },
  ],
  termsTotal: 3,
  keywords: [bd("dns filtering", "PHRASE", 2600, 14000, 700, 11, { quality_score: 7 }), bd("cisco umbrella pricing", "BROAD", 165, 119, 3, 0, { quality_score: 3 })],
  share: Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, share: 0.25 + (i % 5) * 0.03, lostBudget: 0.05, lostRank: 0.7 - (i % 5) * 0.03, top: 0.16, absTop: 0.1 })),
}
const samplePages = [
  { page: "/lp/for-clinics-aba", sourceMedium: "google / cpc", sessions: 420, engaged: 260, conversions: 9, avgDuration: 95 },
  { page: "/", sourceMedium: "google / cpc", sessions: 310, engaged: 120, conversions: 2, avgDuration: 41 },
  { page: "/demo", sourceMedium: "linkedin / paid-social", sessions: 150, engaged: 90, conversions: 6, avgDuration: 70 },
]
const samplePacing = [pp("linkedin", 24235, 20000, "red"), pp("google_ads", 80015, 70000, "red"), pp("meta", 5518, 15000, "amber")]
const sampleCampaigns: CampaignPacing[] = [
  { ...pp("google_ads", 18700, 20000, "green"), campaignId: "1", campaignName: "DG | Search | Non-Brand Core" },
  { ...pp("google_ads", 9842, 0, "no_budget"), budget: null, ratio: null, campaignId: "2", campaignName: "DG | Search | Brand" },
]

/**
 * DEVELOPMENT ONLY: a preview of the design system with sample data, so the look can be checked
 * without signing in. Returns 404 in production. Reads only client names and public logo URLs.
 */

// "Optimise now" on made-up numbers (never real client data), run through the real rules.
const day = (n: number) => new Date(Date.parse("2026-09-27") - n * 864e5).toISOString().slice(0, 10)
const days90 = (f: (n: number) => { spend: number; impressions: number; clicks: number; results: number }) => Array.from({ length: 90 }, (_, n) => ({ date: day(89 - n), ...f(89 - n) }))
const sampleInputs: InsightInputs = {
  clientName: "Sample Co",
  currency: "USD",
  target: 300,
  dataThrough: { google_ads: day(0), linkedin: day(0), meta: day(0) },
  campaigns: [
    { platform: "google_ads", campaignId: "g1", name: "Sample | Search | Non-Brand", daily: days90((n) => ({ spend: 180, impressions: 900, clicks: 40, results: n < 7 ? 0.2 : 0.8 })) },
    { platform: "google_ads", campaignId: "g2", name: "Sample | Search | Competitors", daily: days90((n) => ({ spend: n < 2 ? 0 : 90, impressions: n < 2 ? 0 : 400, clicks: n < 2 ? 0 : 12, results: n % 5 === 0 ? 1 : 0 })) },
    { platform: "linkedin", campaignId: "l1", name: "Sample_Cold_JobTitles_LG", daily: days90(() => ({ spend: 60, impressions: 2500, clicks: 11, results: 0 })) },
    { platform: "meta", campaignId: "m1", name: "Sample_Meta_Retargeting", daily: days90((n) => ({ spend: 70, impressions: 3000, clicks: 25, results: n % 3 === 0 ? 1 : 0 })) },
  ],
  ads: [
    { platform: "meta", external_account_id: "a", campaignId: "m1", campaignName: "Sample_Meta_Retargeting", adId: "ad1", adName: "Sample: customer quote video", last7: { spend: 250, impressions: 9000, clicks: 120, results: 3 }, prev7: { spend: 240, impressions: 9500, clicks: 70, results: 2 } },
  ],
  terms: [
    { campaignId: "g1", campaignName: "Sample | Search | Non-Brand", term: "free sample widgets", spend: 720, impressions: 3100, clicks: 140, results: 0, isKeyword: false },
    { campaignId: "g1", campaignName: "Sample | Search | Non-Brand", term: "widget jobs", spend: 640, impressions: 2200, clicks: 96, results: 0, isKeyword: false },
    { campaignId: "g1", campaignName: "Sample | Search | Non-Brand", term: "sample co login", spend: 900, impressions: 1500, clicks: 300, results: 0, isKeyword: false },
    { campaignId: "g1", campaignName: "Sample | Search | Non-Brand", term: "widget platform for teams", spend: 410, impressions: 900, clicks: 51, results: 4, isKeyword: false },
  ],
  share: Array.from({ length: 14 }, (_, n) => ({ campaignId: "g1", campaignName: "Sample | Search | Non-Brand", date: day(n), lostBudget: 0.02, lostRank: 0.58 })),
  metaAdsets: [{ campaignId: "m1", campaignName: "Sample_Meta_Retargeting", value: "as1", adsetName: "Sample: site visitors 30d", m: { spend: 490, impressions: 21000, clicks: 175, results: 2 }, reach: 3800, frequency: 5.5, learning: "FAIL" }],
  metaLearningDays: [],
  metaAges: [],
  metaPlacements: [],
  linkedin: {
    li_company: {
      asOf: day(0),
      rows: [
        { campaignId: "l1", campaignName: "Sample_Cold_JobTitles_LG", value: "Sample Co", m: { spend: 40, impressions: 800, clicks: 3, results: 0 } },
        { campaignId: "l1", campaignName: "Sample_Cold_JobTitles_LG", value: "Widget Recruiters Ltd", m: { spend: 25, impressions: 300, clicks: 4, results: 0 } },
        { campaignId: "l2", campaignName: "Sample_Retargeting_Visitors", value: "Widget Recruiters Ltd", m: { spend: 12, impressions: 140, clicks: 1, results: 0 } },
        { campaignId: "l3", campaignName: "Sample_Event_MatchedAudience", value: "Widget Recruiters Ltd", m: { spend: 9, impressions: 90, clicks: 1, results: 0 } },
        { campaignId: "l1", campaignName: "Sample_Cold_JobTitles_LG", value: "Example University", m: { spend: 18, impressions: 210, clicks: 2, results: 0 } },
      ],
    },
    li_seniority: {
      asOf: day(0),
      rows: [
        { campaignId: "l1", campaignName: "Sample_Cold_JobTitles_LG", value: "Director", m: { spend: 700, impressions: 30000, clicks: 150, results: 0 } },
        { campaignId: "l1", campaignName: "Sample_Cold_JobTitles_LG", value: "Entry", m: { spend: 500, impressions: 22000, clicks: 30, results: 0 } },
        { campaignId: "l1", campaignName: "Sample_Cold_JobTitles_LG", value: "Training", m: { spend: 150, impressions: 8000, clicks: 10, results: 0 } },
      ],
    },
  },
  landing: [],
}
const sampleFeed = applyActions(computeInsights(sampleInputs), [{ insight_key: "negatives:google_ads:g1", action: "done", items: ["widget jobs"], snooze_until: null, created_at: "2026-09-26T10:00:00Z", profile_name: "Sample Person" }], "2026-09-29")

export default async function DesignPreview() {
  if (process.env.NODE_ENV !== "development") notFound()
  const { data: clients } = await createAdminClient().from("clients").select("slug, name, logo_url").order("name")
  const sampleImg = clients?.find((c) => c.logo_url)?.logo_url ?? null
  const rows = [
    { t: "Increase budget on the Google Search brand campaign", o: "proven", c: 1, p: "google_ads" as const, f: "More conversions and a lower cost per conversion, up to ~$1,500/day." },
    { t: "Hard push on free trials to a cold audience on all platforms", o: "disproven", c: 1, p: null, f: "Bad quality traffic and few activated trials." },
    { t: "Mock: ABX personalised ads to named enterprise accounts", o: "proven", c: 0, p: "linkedin" as const, f: "Roughly double CTR among target accounts." },
    { t: "Mock: SMB lead gen: Meta instant forms vs landing page", o: "inconclusive", c: 0, p: "meta" as const, f: "Cheaper leads, but quality unclear." },
  ]
  const dot = { proven: "bg-rag-green", disproven: "bg-rag-red", inconclusive: "bg-rag-na" } as const

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <AppSidebar clients={clients ?? []} name="Dean Steinhobel" roleLabel="Admin" isAdmin hasRole />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl space-y-12 px-4 py-8 sm:px-8 lg:py-10">
          <PageHeader
            eyebrow="Design preview"
            title="Sauvignon Blanc"
            description="Sample data only. This page exists in development to check the look."
            actions={
              <>
                <Button variant="outline">Secondary</Button>
                <Button>Primary action</Button>
              </>
            }
          />

          <section className="space-y-4">
            <SectionHeader title="Clients" description="Cards with logos and platform status." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(clients ?? []).map((c) => (
                <div key={c.slug} className="surface space-y-4 p-5 transition-colors hover:border-foreground/20">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-3">
                      <ClientLogo name={c.name} logoUrl={c.logo_url} size="md" />
                      <span className="text-lg">{c.name}</span>
                    </span>
                    <StatusBadge status="red" label="Pacing red" />
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <PlatformLabel platform="linkedin" />
                    <PlatformLabel platform="google_ads" />
                    <PlatformLabel platform="meta" />
                  </div>
                  <dl className="grid grid-cols-3 gap-3 border-t pt-4">
                    {[
                      ["Checks this week", "100%"],
                      ["Tests live", "2"],
                      ["Reds open", "0"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-[11px] text-muted-foreground">{k}</dt>
                        <dd className="font-heading text-2xl">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader title="List rows" description="Learnings-style rows." />
            <div className="flex items-center gap-2">
              <Input placeholder="Search" className="h-9 w-64 bg-card" />
              {["All 4", "Proven 2", "Disproven 1", "Inconclusive 1"].map((l, i) => (
                <span key={l} className={i === 0 ? "rounded-full border border-foreground/20 bg-accent px-3 py-1 text-sm" : "rounded-full border px-3 py-1 text-sm text-muted-foreground"}>
                  {l}
                </span>
              ))}
            </div>
            <ul className="surface divide-y overflow-hidden">
              {rows.map((r) => {
                const c = clients?.[r.c]
                return (
                  <li key={r.t} className="flex items-center gap-4 px-4 py-3.5 hover:bg-accent/40">
                    <span className={`size-2 rounded-full ${dot[r.o as keyof typeof dot]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.t}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.f}</span>
                    </span>
                    {c && (
                      <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
                        <ClientLogo name={c.name} logoUrl={c.logo_url} size="xs" />
                        {c.name}
                      </span>
                    )}
                    <PlatformLabel platform={r.p} className="hidden w-28 text-xs text-muted-foreground md:inline-flex" fallback="Several" />
                    <span className="hidden w-16 text-right text-xs text-muted-foreground md:block">Sprint 0</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="space-y-4">
            <SectionHeader title="Budget pacing" description="Sliders with the today marker." />
            <PacingPanel platforms={samplePacing} campaigns={sampleCampaigns} currency="USD" month="2026-09-01" canEdit clientSlug="dnsfilter" />
          </section>

          <section className="space-y-4">
            <SectionHeader title="Optimise now" description="The real rules on made-up numbers." />
            <InsightFeed slug="sample" clientName="Sample Co" currency="USD" target={300} insights={sampleFeed} dataThrough={day(0)} checked={[{ platform: "google_ads", through: day(0) }, { platform: "linkedin", through: day(0) }, { platform: "meta", through: day(0) }, { platform: "ga4", through: day(0) }]} previews={{}} owners={[{ id: "00000000-0000-0000-0000-000000000000", name: "Sample Person", onTeam: true }]} live={false} defaultDue="2026-10-02" sprintNumber={1} openKey={null} />
          </section>

          <section className="space-y-4">
            <SectionHeader title="Performance" description="Synthetic sample data." />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <TrendPanel daily={perfDaily} prevDaily={perfPrev} currency="USD" />
              <div className="space-y-6">
                <Investigator now={perfNow} prev={perfBefore} currency="USD" />
                <PlatformSplit platforms={perfCampaigns.map((c) => ({ platform: c.platform, now: c.now }))} currency="USD" />
              </div>
            </div>
            <CampaignTable rows={perfCampaigns} currency="USD" slug="dnsfilter" query="" target={300} />
            <CampaignDetailData data={sampleGoogle} currency="USD" target={300} />
            <LandingPages rows={samplePages} />
          </section>

          <section className="space-y-4">
            <SectionHeader title="Pour me a sprint" description="The wine glass at 10%, 45%, 80% and served." />
            <div className="flex flex-wrap items-end gap-8">
              {[0.1, 0.45, 0.8, 1].map((p) => (
                <WinePour key={p} progress={p} pouring={p < 1} className="h-56 w-48 text-foreground" />
              ))}
            </div>
            <div className="space-y-10">
              <AiPanel sprintId="empty" canGenerate aiReady closed={false} run={null} recs={[]} owners={[]} defaultDeadline="2026-10-02" currency="USD" />
              <h2 className="text-2xl">Tests this sprint</h2>
            </div>
            <AiPanel
              sprintId="sample"
              canGenerate
              aiReady
              closed={false}
              run={{ id: "r", status: "ready", created_at: "2026-09-28T10:00:00Z", error: null, market_summary: "LinkedIn is pushing Thought Leader Ads and conversation ads for B2B, while Google keeps folding search into AI Max. Practitioners on r/PPC report CPC inflation on generic security terms.", news: [{ platform: "LinkedIn", headline: "Thought Leader Ads open to all advertisers", detail: "Sponsor any member's post from the Campaign Manager.", date: "2026-09-10", url: "https://example.com/li" }] }}
              recs={[
                { id: "a", run_id: "r", summary: "LinkedIn CTR has more than halved since August while the CTO's posts outperform brand posts.", impact: "high", expected_impact: "CTR back to ~0.8%, ~+10 results", evidence: [{ label: "LinkedIn CTR", value: "1.10% → 0.46%" }, { label: "Cost per result", value: "USD 968" }, { label: "Best ad CTR", value: "1.13%" }], status: "draft", platform: "linkedin", title: "Thought Leader Ads from the CTO vs brand posts", hypothesis: "If we sponsor the CTO's posts, CTR rises because people trust people over logos.", assets: ["ad_copy"], brief_notes: null, success_metric: "ctr", success_target: 0.8, success_text: null, why_data: "LinkedIn CTR has slid from 1.10% (w/e 2 Aug) to 0.46% (w/e 27 Sep).", why_market: "Thought Leader Ads are now open to all advertisers.", sources: [{ title: "LinkedIn blog", url: "https://example.com/li" }], confidence: "medium", effort: "low", reject_reason: null, sprint_test_id: null },
                { id: "b", run_id: "r", summary: null, impact: "medium", expected_impact: null, evidence: [], status: "reviewed", platform: "reddit", title: "Ungated AI Security report on Reddit, retarget readers", hypothesis: "Ungating lowers cost per engaged reader; retargeting converts them.", assets: ["landing_page", "ad_creative"], brief_notes: null, success_metric: null, success_target: null, success_text: "Retargeted readers start trials at under $300 each", why_data: "Sprint 0: gated report leads were very expensive and didn't start trials.", why_market: null, sources: [], confidence: "low", effort: "medium", reject_reason: null, sprint_test_id: null },
              ]}
              owners={[{ id: "u1", name: "Andrea Restrepo", onTeam: true }]}
              defaultDeadline="2026-10-02"
              currency="USD"
            />
          </section>

          <section className="space-y-4">
            <SectionHeader title="Creative cards" description="New creatives this month." />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {[
                { name: "Intuitive Query Log for Precise Filtering", p: { src: sampleImg, link: null, textOnly: false } },
                { name: "A clearer shadow AI conversation for client reviews", p: { src: null, link: null, textOnly: false, kind: "Document ad" } },
                { name: "DNS Filtering Service", p: { src: null, link: null, textOnly: true, textAd: { headlines: [{ text: "DNS Filtering Service", pinned: null }, { text: "Start Your Free 14-Day Trial", pinned: null }], descriptions: [{ text: "Block malware and phishing at the DNS layer.", pinned: null }], path1: null, path2: null, finalUrl: "https://www.dnsfilter.com/" } } },
              ].map((c) => (
                <li key={c.name} className="group/card surface overflow-hidden">
                  <AdThumb preview={c.p} alt={c.name} size="card" className="rounded-none border-0 border-b" />
                  <p className="line-clamp-2 p-3 text-xs font-medium">{c.name}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <SectionHeader title="Ad fatigue" description="Compact tiles; click one to expand." />
            <FatiguePanel ads={sampleAds} previews={{ "meta|1|b": { src: sampleImg, link: null, textOnly: false }, "google_ads|1|a": { src: null, link: null, textOnly: true, textAd: { headlines: [{ text: "DNS Filtering Service", pinned: "HEADLINE_1" }, { text: "Start Your Free 14-Day Trial", pinned: null }, { text: "AI-Powered Threat Blocking", pinned: null }, { text: "Up to 6 Months Free", pinned: null }], descriptions: [{ text: "Block malware, phishing and ransomware at the DNS layer.", pinned: null }, { text: "Deploy in minutes. 24/7 support.", pinned: null }], path1: "dns", path2: "filtering", finalUrl: "https://www.dnsfilter.com/dns-filtering" } }, "linkedin|1|c": { src: null, link: null, textOnly: false, kind: "Document ad" } }} currency="USD" />
          </section>

          <CheckDeck title="Week of 28 Sept 2026 – 4 Oct 2026" subtitle="Weekly checks (sample)" items={deckItems} />

          <section className="space-y-4">
            <SectionHeader title="Status and creatives" description="Hover the image to enlarge it." />
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status="green" />
              <StatusBadge status="amber" />
              <StatusBadge status="red" />
              <StatusBadge status="na" />
              <AdThumb preview={{ src: sampleImg, link: null, textOnly: false }} alt="Sample creative" />
              <AdThumb preview={{ src: null, link: null, textOnly: true }} alt="Text ad" />
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
