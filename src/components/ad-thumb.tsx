"use client"
/* eslint-disable @next/next/no-img-element -- signed, short-lived Supabase Storage URLs; next/image adds nothing here */
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import type { Preview, TextAd } from "@/lib/previews"
import { cn } from "@/lib/utils"

// "card" fills its container as a square (creative galleries); the rest are fixed thumbnails.
const SIZE = { sm: "size-10", md: "size-16", lg: "size-28", card: "aspect-square w-full" } as const

/**
 * Saved preview image, a mock Google result for search ads, or a tile naming the ad type. Hovering
 * an image or search ad shows it large. Meta ads link to Meta's preview, LinkedIn ads to the post
 * (for document ads, which Windsor has no image for, that link is the only preview).
 */
export function AdThumb({ preview, alt, size = "md", className }: { preview?: Preview; alt: string; size?: keyof typeof SIZE; className?: string }) {
  const tile = cn("shrink-0 overflow-hidden rounded-md border bg-elevated", SIZE[size], className)
  if (!preview?.src && preview?.textAd) return <SearchAdThumb ad={preview.textAd} alt={alt} className={cn(tile, "border-transparent")} size={size} />
  const site = preview?.link ? linkSite(preview.link) : null
  if (!preview?.src && size === "card") {
    const card = <CardPlaceholder kind={preview?.textOnly ? "Text ad" : (preview?.kind ?? null)} alt={alt} className={cn(tile, site && "transition-colors group-hover/card:border-foreground/30 hover:border-foreground/30")} site={site} />
    return site ? <a href={preview!.link!} target="_blank" rel="noreferrer" className="block" aria-label={`${alt}: open the ad in ${site}`}>{card}</a> : card
  }
  if (!preview?.src) {
    const label = preview?.textOnly ? "Text ad" : (preview?.kind ?? "No preview")
    const cls = cn(tile, "flex items-center justify-center p-1 text-center text-[10px] leading-tight text-muted-foreground")
    if (site)
      return (
        <a href={preview!.link!} target="_blank" rel="noreferrer" className={cn(cls, "transition-colors hover:border-foreground/30 hover:text-foreground")} aria-label={`${alt}: ${label}, open it in ${site}`} title={`Open in ${site}`}>
          {label}
        </a>
      )
    return (
      <span className={cls} aria-label={preview?.kind ? `${label}, no image from Windsor` : label} title={preview?.kind ? "Windsor has no image for this ad type" : undefined}>
        {label}
      </span>
    )
  }
  const image =
    size === "card" ? (
      // The whole creative, uncropped, over a blurred copy of itself so any aspect ratio fills the square.
      <span className={cn(tile, "relative block")}>
        <img src={preview.src} alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-xl" />
        <img src={preview.src} alt={alt} loading="lazy" className="relative size-full object-contain transition-transform duration-300 group-hover/card:scale-[1.02]" />
      </span>
    ) : (
      <img src={preview.src} alt={alt} loading="lazy" className={cn(tile, "object-cover transition-opacity hover:opacity-90")} />
    )
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        render={preview.link ? <a href={preview.link} target="_blank" rel="noreferrer" className={cn("shrink-0", size === "card" && "block")} aria-label={`${alt}: view the ad in ${site}`} /> : <span className={cn("shrink-0", size === "card" && "block")} tabIndex={0} />}
      >
        {image}
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-[min(380px,85vw)] border-border bg-popover p-2">
        <img src={preview.src} alt={alt} className="max-h-[70vh] w-full rounded-md object-contain" />
        <p className="mt-2 line-clamp-2 px-1 text-xs text-muted-foreground">{alt}</p>
        {site && <p className="px-1 pb-1 text-xs text-foreground">Click to open the ad in {site}</p>}
      </HoverCardContent>
    </HoverCard>
  )
}

/** Which platform a preview link opens on. */
function linkSite(link: string) {
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(link).hostname) ? "LinkedIn" : "Meta"
  } catch {
    return "Meta"
  }
}

export function ViewAdLink({ preview }: { preview?: Preview }) {
  if (!preview?.link) return null
  const site = linkSite(preview.link)
  return (
    <a href={preview.link} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline hover:text-foreground">
      {preview.src || site === "Meta" ? "View ad" : `Open in ${site}`}
    </a>
  )
}

/** One combination Google could show: pinned headlines in their slots, the rest in order. */
function arrange(ad: TextAd) {
  const pick = (list: TextAd["headlines"], slots: string[], n: number) => {
    const out: string[] = []
    const rest = list.filter((x) => !x.pinned).map((x) => x.text)
    for (let i = 0; i < n; i++) {
      const pinned = list.find((x) => x.pinned === slots[i])
      const next = pinned?.text ?? rest.shift()
      if (next) out.push(next)
    }
    return out
  }
  const headlines = pick(ad.headlines, ["HEADLINE_1", "HEADLINE_2", "HEADLINE_3"], 3)
  const descriptions = pick(ad.descriptions, ["DESCRIPTION_1", "DESCRIPTION_2"], 2)
  let domain = ""
  try {
    domain = ad.finalUrl ? new URL(ad.finalUrl).hostname.replace(/^www\./, "") : ""
  } catch {}
  const path = [domain || "example.com", ad.path1, ad.path2].filter(Boolean).join(" › ")
  return { headlines, descriptions, domain, path }
}

function SearchAdThumb({ ad, alt, className, size }: { ad: TextAd; alt: string; className: string; size: keyof typeof SIZE }) {
  const a = arrange(ad)
  return (
    <HoverCard>
      <HoverCardTrigger delay={150} render={<span className={cn("shrink-0", size === "card" && "block")} tabIndex={0} aria-label={`${alt}: search ad mock`} />}>
        {/* A tiny Google result: Sponsored, then the blue headline (and the description on cards). */}
        <span className={cn(className, "flex flex-col gap-0.5 bg-white p-1 text-left", size === "lg" && "p-2", size === "card" && "justify-center gap-1.5 p-4")}>
          <span className={cn("font-bold text-[#202124]", size === "card" ? "text-[11px]" : size === "lg" ? "text-[9px]" : "text-[6px]")}>Sponsored</span>
          <span className={cn("font-medium leading-tight text-[#1a0dab]", size === "card" ? "line-clamp-4 text-[15px]" : size === "lg" ? "line-clamp-4 text-[11px]" : size === "md" ? "line-clamp-4 text-[8px]" : "line-clamp-3 text-[6px]")}>{a.headlines.join(" | ")}</span>
          {size === "card" && <span className="line-clamp-3 text-[11px] leading-snug text-[#4d5156]">{a.descriptions.join(" ")}</span>}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-[min(420px,85vw)] border-border bg-popover p-2">
        <SearchAdMock ad={ad} />
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          A mock of one way it can show. Google mixes {ad.headlines.length} headlines and {ad.descriptions.length} descriptions.
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}

/** Mock of a Google search ad, drawn from the ad's copy (Windsor has no image for search ads). */
export function SearchAdMock({ ad, className }: { ad: TextAd; className?: string }) {
  const a = arrange(ad)
  return (
    <div className={cn("rounded-md bg-white p-4 font-[Arial,sans-serif] text-left", className)}>
      <p className="text-[13px] font-bold text-[#202124]">Sponsored</p>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[#dadce0] bg-[#f1f3f4] text-[11px] font-bold uppercase text-[#5f6368]">
          {(a.domain || "?").slice(0, 1)}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[14px] text-[#202124]">{a.domain || "Website"}</span>
          <span className="block truncate text-[12px] text-[#4d5156]">{a.path}</span>
        </span>
      </div>
      <p className="mt-2 text-[20px] leading-snug text-[#1a0dab]">{a.headlines.join(" | ")}</p>
      <p className="mt-1 text-[14px] leading-snug text-[#4d5156]">{a.descriptions.join(" ")}</p>
    </div>
  )
}

/** Card-size tile for ads Windsor has no image for: a document-style cover with the ad type. */
function CardPlaceholder({ kind, alt, className, site }: { kind: string | null; alt: string; className: string; site?: string | null }) {
  return (
    <span
      className={cn(className, "flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-elevated to-card text-muted-foreground")}
      role="img"
      aria-label={`${alt}: ${kind ?? "no preview"}`}
      title={site ? `Open in ${site}` : kind ? "Windsor has no image for this ad type" : undefined}
    >
      <svg viewBox="0 0 40 48" className="h-14 w-12 text-foreground/35" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M4 2h22l10 10v34H4z" />
        <path d="M26 2v10h10M10 22h20M10 28h20M10 34h13" />
      </svg>
      <span className="text-xsr">{kind ?? "No preview"}</span>
      {site && <span className="text-[11px] text-foreground/70 underline underline-offset-2">Open in {site} ↗</span>}
    </span>
  )
}
