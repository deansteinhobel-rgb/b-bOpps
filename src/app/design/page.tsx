import { notFound } from "next/navigation"
import { AdThumb } from "@/components/ad-thumb"
import { AppSidebar } from "@/components/app-sidebar"
import { ClientLogo, PlatformLabel } from "@/components/brand"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * DEVELOPMENT ONLY: a preview of the design system with sample data, so the look can be checked
 * without signing in. Returns 404 in production. Reads only client names and public logo URLs.
 */
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
