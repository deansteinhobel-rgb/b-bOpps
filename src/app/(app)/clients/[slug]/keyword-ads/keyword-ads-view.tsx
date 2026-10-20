"use client"
/* eslint-disable @next/next/no-img-element -- signed, short-lived Supabase Storage URLs */

import { ExternalLink, RefreshCw, X } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { PlatformIcon } from "@/components/brand"
import { SectionHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import type { KeywordAdView, KeywordRow, KeywordSummary } from "@/lib/competitors/keyword-load"
import { SOURCE_LABEL, type KeywordSource } from "@/lib/competitors/sources"
import { SOURCE_PLATFORM } from "@/lib/competitors/view"
import { cn } from "@/lib/utils"
import { addKeyword, readAgain, removeKeyword } from "../competitors/actions"

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
const DAY = 86_400_000

const day = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit" }).format(new Date(d))
/**
 * How long the creative has run: since its earliest version we know of, saying so when this version
 * is newer. Meta starts the date again when an ad is edited and keeps no earlier entry, so its
 * days are a minimum ("at least"). LinkedIn rarely shows dates; its order then comes from ad ids.
 */
function ranFor(a: KeywordAdView, today: string) {
  if (!a.started_on && a.source === "linkedin" && a.since === a.first_seen_at.slice(0, 10)) return "Older ad (by LinkedIn's ad id)"
  const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(a.since)) / DAY))
  const version = a.started_on && a.started_on > a.since ? ` (this version since ${day(a.started_on)})` : ""
  return `Live at least ${days} days, since ${day(a.since)}${version}`
}

/**
 * Reporting › Keyword ads (Dean, 2026-10-20). For each of the client's keywords, the Meta Ad Library
 * and LinkedIn Ad Library are searched every other Sunday. The overview shows the 3 ads that
 * have run longest among each search's top 30; pick a keyword to see its whole top 30 in the
 * library's own order. The client's own ads are left out of the picks.
 */
export function KeywordAdsView(props: {
  slug: string
  clientName: string
  today: string
  canEdit: boolean
  keywords: KeywordRow[]
  selected: { id: string; source: KeywordSource } | null
  top: KeywordAdView[]
  summaries: KeywordSummary[]
  lastReadAt: string | null
}) {
  const { slug, today, keywords, selected, summaries } = props
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const href = (k: string, s: KeywordSource) => `${pathname}?k=${k}&s=${s}`
  const kw = keywords.find((k) => k.id === selected?.id)
  const picks = summaries.find((s) => s.keywordId === selected?.id && s.source === selected?.source)?.picks ?? []
  const pickIds = new Set(picks.map((p) => p.id))
  const hasAds = summaries.some((s) => s.count > 0)

  const read = () =>
    start(async () => {
      const r = await readAgain(slug)
      if (!r.ok) toast.error(r.message ?? "Couldn't start the read.")
      else toast.success(r.queued ? `Reading ${r.queued} library searches. Results show here in a few minutes; refresh the page.` : "Everything on the list was read in the last 2 weeks. The next read is on a Sunday.")
    })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          What the market runs for {props.clientName}&apos;s keywords: the Meta Ad Library and LinkedIn Ad Library searched every other Sunday. For each search, the top 30 ads in the library&apos;s own order, and the 3 of those that have run longest, which are usually the ones that work. {props.clientName}&apos;s own ads are left out of the picks. Meta starts an ad&apos;s date again when it&apos;s edited, so its days are a minimum; our reads keep the earliest date we&apos;ve seen.
          {props.lastReadAt && <span className="text-subtle-foreground"> Last read {when(props.lastReadAt)}.</span>}
        </p>
        {props.canEdit && (
          <Button size="sm" variant="outline" onClick={read} disabled={pending || !keywords.length}>
            <RefreshCw className={cn(pending && "animate-spin")} /> Read again now
          </Button>
        )}
      </div>

      {hasAds && (
        <section className="space-y-4">
          <SectionHeader title="Running longest, by keyword" description="The 3 longest-running ads among each search's top 30. Click a keyword to see all 30." />
          <div className="surface overflow-hidden">
            <ul className="divide-y">
              {keywords.map((k) =>
                (["linkedin", "meta"] as const)
                  .filter((s) => k.sources.includes(s))
                  .map((s) => {
                    const sum = summaries.find((x) => x.keywordId === k.id && x.source === s)
                    const on = selected?.id === k.id && selected.source === s
                    return (
                      <li key={`${k.id}-${s}`} className={cn("grid gap-3 px-4 py-3 md:grid-cols-[14rem_1fr]", on && "bg-white/[0.04]")}>
                        <Link href={href(k.id, s)} scroll={false} className="flex items-start gap-2 text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                          <PlatformIcon platform={SOURCE_PLATFORM[s]} className="mt-0.5" />
                          <span>
                            <span className={cn("block", on ? "font-medium text-foreground" : "text-body")}>{k.keyword}</span>
                            <span className="text-xs text-muted-foreground">{sum?.count ? `${sum.count} ads · see all` : "No ads yet"}</span>
                          </span>
                        </Link>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          {(sum?.picks ?? []).map((a) => (
                            <MiniAd key={a.id} ad={a} today={today} />
                          ))}
                        </div>
                      </li>
                    )
                  }),
              )}
            </ul>
          </div>
        </section>
      )}

      {kw && selected && (
        <section className="space-y-4">
          <SectionHeader
            title={
              <span className="inline-flex items-center gap-2">
                <PlatformIcon platform={SOURCE_PLATFORM[selected.source]} className="size-5" /> &ldquo;{kw.keyword}&rdquo;: top {props.top.length}
              </span>
            }
            description={`${SOURCE_LABEL[selected.source]}'s own order. The 3 longest-running are marked; ads Claude found off-topic are faded and never picked (hover for why).`}
            actions={
              kw.sources.length > 1 && (
                <div className="flex gap-1">
                  {(kw.sources as KeywordSource[]).map((s) => (
                    <Link key={s} href={href(kw.id, s)} scroll={false} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px]", s === selected.source ? "bg-white/[0.08] font-medium text-foreground" : "text-body hover:bg-white/[0.04]")}>
                      <PlatformIcon platform={SOURCE_PLATFORM[s]} /> {SOURCE_LABEL[s]}
                    </Link>
                  ))}
                </div>
              )
            }
          />
          {props.top.length ? (
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {props.top.map((a, i) => (
                <li key={a.id}>
                  <AdCard ad={a} rank={i + 1} today={today} pick={pickIds.has(a.id)} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="surface px-4 py-6 text-sm text-muted-foreground">
              {kw.created_at > new Date().toISOString()
                ? `This keyword is read from ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(kw.created_at))}, after Apify's monthly credit resets.`
                : `No ads for this search yet. Searches run every other Sunday${props.canEdit ? ", or now with Read again" : ""}.`}
            </p>
          )}
        </section>
      )}

      <ManageKeywords slug={slug} keywords={keywords} canEdit={props.canEdit} />
    </div>
  )
}

function Creative({ ad, className }: { ad: KeywordAdView; className?: string }) {
  return ad.src ? (
    <span className={cn("relative block overflow-hidden rounded-md border bg-elevated", className)}>
      <img src={ad.src} alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-xl" />
      <img src={ad.src} alt={ad.headline ?? `${ad.advertiser ?? "An advertiser"}'s ad`} loading="lazy" className="relative size-full object-contain" />
    </span>
  ) : (
    <span className={cn("flex items-center justify-center rounded-md border bg-elevated p-3 text-center text-xs text-body", className)}>
      <span className="line-clamp-5">{ad.headline ?? ad.body ?? "No preview in the library"}</span>
    </span>
  )
}

/** A pick in the overview: small creative, advertiser, how long it has run. Opens the ad library. */
function MiniAd({ ad, today }: { ad: KeywordAdView; today: string }) {
  return (
    <a href={ad.library_url ?? undefined} target="_blank" rel="noreferrer" className="group flex min-w-0 items-center gap-2.5 rounded-md p-1 outline-none hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring">
      <Creative ad={ad} className="size-14 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-foreground">{ad.advertiser ?? "Unknown advertiser"}</span>
        <span className="block truncate text-xs text-muted-foreground" title={ranFor(ad, today)}>{ranFor(ad, today)}</span>
        <span className="block truncate text-xs text-body">{ad.headline ?? ad.body ?? ""}</span>
      </span>
    </a>
  )
}

function AdCard({ ad, rank, today, pick }: { ad: KeywordAdView; rank: number; today: string; pick: boolean }) {
  const off = ad.relevance === "off_topic"
  return (
    <a
      href={ad.library_url ?? undefined}
      target="_blank"
      rel="noreferrer"
      title={ad.relevance_reason ? `${off ? "Off-topic" : ad.relevance === "unsure" ? "Unsure" : "Relevant"}: ${ad.relevance_reason}` : undefined}
      className={cn("group flex w-full flex-col gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", off && "opacity-45 hover:opacity-100")}
    >
      <span className="relative block">
        <Creative ad={ad} className={cn("aspect-square w-full transition-colors group-hover:border-foreground/30", pick && "border-lime/60")} />
        <span className="absolute top-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-foreground tabular-nums">#{rank}</span>
      </span>
      <span className="flex items-center gap-1.5 text-[13px]">
        <span className="truncate font-medium text-foreground">{ad.advertiser ?? "Unknown advertiser"}</span>
        {pick && <span className="pill shrink-0 border-lime/50 text-lime">Running longest</span>}
        {off && <span className="pill shrink-0">Off-topic</span>}
      </span>
      <span className="text-xs text-muted-foreground">
        {ranFor(ad, today)} · {ad.countries.join(", ")}
      </span>
      {ad.headline && <span className="line-clamp-2 text-xs text-body">{ad.headline}</span>}
      {ad.library_url && (
        <span className="inline-flex items-center gap-1 text-[11px] text-subtle-foreground group-hover:text-foreground">
          Open in the ad library <ExternalLink className="size-3" />
        </span>
      )}
    </a>
  )
}

/** The keyword list. The team adds and removes; viewers read. */
function ManageKeywords({ slug, keywords, canEdit }: { slug: string; keywords: KeywordRow[]; canEdit: boolean }) {
  const [text, setText] = useState("")
  const [sources, setSources] = useState<KeywordSource[]>(["linkedin", "meta"])
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const add = () =>
    start(async () => {
      const r = await addKeyword(slug, text, sources)
      if (r.ok) setText("")
      setMsg(r.ok ? null : (r.message ?? "Couldn't add it."))
    })
  const remove = (k: KeywordRow) =>
    start(async () => {
      const r = await removeKeyword(slug, k.id)
      if (!r.ok) toast.error(r.message ?? "Couldn't remove it.")
    })
  const toggle = (s: KeywordSource) => setSources((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
  return (
    <section className="space-y-4">
      <SectionHeader title="Keywords" description="Searched in each library every other Sunday. Words a buyer or partner would see ads for. Each keyword costs about $0.04 a read, so keep the list short." />
      <div className="surface overflow-hidden">
        <ul className="flex flex-wrap gap-2 p-4">
          {keywords.map((k) => (
            <li key={k.id} className="group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] text-body">
              {(k.sources as KeywordSource[]).map((s) => (
                <PlatformIcon key={s} platform={SOURCE_PLATFORM[s]} className="size-3.5" />
              ))}
              {k.keyword}
              {k.created_at > new Date().toISOString() && (
                <span className="text-[11px] text-subtle-foreground" title="Read from this date (after Apify's monthly credit resets)">
                  from {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(k.created_at))}
                </span>
              )}
              {canEdit && (
                <button type="button" disabled={pending} onClick={() => remove(k)} className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Remove ${k.keyword}`}>
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
          {!keywords.length && <li className="text-sm text-muted-foreground">No keywords yet.</li>}
        </ul>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t p-3">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. a product category your buyers search for" className="h-8 min-w-48 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30" aria-label="New keyword" />
            {(["linkedin", "meta"] as const).map((s) => (
              <label key={s} className="inline-flex items-center gap-1.5 text-[13px] text-body">
                <input type="checkbox" checked={sources.includes(s)} onChange={() => toggle(s)} className="accent-lime" />
                <PlatformIcon platform={SOURCE_PLATFORM[s]} /> {SOURCE_LABEL[s]}
              </label>
            ))}
            <Button size="sm" disabled={pending || !text.trim() || !sources.length} onClick={add}>
              Add
            </Button>
          </div>
        )}
        {msg && <p className="px-3 pb-3 text-xs text-rag-red">{msg}</p>}
      </div>
    </section>
  )
}
