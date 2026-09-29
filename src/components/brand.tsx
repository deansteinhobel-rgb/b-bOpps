/* eslint-disable @next/next/no-img-element -- small brand images from Supabase Storage */
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"

/** Platforms we show a mark for: the three connected ones, plus ones Pour a Sprint may suggest. */
export type AnyPlatform = Platform | "bing" | "reddit" | "x" | "chatgpt"
// Official marks (Dean, 2026-09-29), in /public/platforms. Google, Meta and Microsoft have their white
// backgrounds removed so they sit on the dark UI; LinkedIn, Reddit and X keep their own tile.
const MARK: Partial<Record<AnyPlatform, { src: string; alt: string; tile?: boolean }>> = {
  linkedin: { src: "/platforms/linkedin.png", alt: "LinkedIn", tile: true },
  google_ads: { src: "/platforms/google_ads.png", alt: "Google Ads" },
  meta: { src: "/platforms/meta.png?v=2", alt: "Meta" },
  bing: { src: "/platforms/microsoft.png", alt: "Microsoft Ads" },
  reddit: { src: "/platforms/reddit.png", alt: "Reddit", tile: true },
  x: { src: "/platforms/x.png", alt: "X", tile: true },
}

/** Platform marks, sized to sit inline with text. Unknown or mixed platforms get a neutral grid. */
export function PlatformIcon({ platform, className }: { platform: AnyPlatform | null; className?: string }) {
  const cls = cn("inline-block size-4 shrink-0", className)
  const mark = platform ? MARK[platform] : undefined
  if (mark) return <img src={mark.src} alt="" aria-hidden className={cn(cls, "object-contain", mark.tile && "rounded-[22%] ring-1 ring-white/10")} draggable={false} />
  return (
    <svg viewBox="0 0 24 24" className={cn(cls, "text-muted-foreground")} aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" opacity=".7" />
      <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" opacity=".45" />
      <rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity=".45" />
      <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" opacity=".7" />
    </svg>
  )
}

/** Platform icon + name, e.g. in lists and cards. */
export function PlatformLabel({ platform, className, fallback = "Several platforms" }: { platform: Platform | null; className?: string; fallback?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <PlatformIcon platform={platform} />
      <span>{platform ? PLATFORM_LABEL[platform] : fallback}</span>
    </span>
  )
}

const SIZE = { xs: "size-4 text-[8px] rounded", sm: "size-5 text-[9px] rounded-md", md: "size-7 text-[11px] rounded-md", lg: "size-10 text-sm rounded-lg" } as const

/** Client logo on a rounded tile; initials when there's no logo yet. */
export function ClientLogo({ name, logoUrl, size = "sm", className }: { name: string; logoUrl?: string | null; size?: keyof typeof SIZE; className?: string }) {
  const tile = cn("inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-white/10", SIZE[size], className)
  if (logoUrl) {
    // Square logos with their own background (marked "fit=cover" in the URL) fill the tile; others sit
    // padded on white, like favicons.
    const cover = logoUrl.includes("fit=cover")
    return (
      <span className={tile}>
        <img src={logoUrl} alt="" className={cover ? "size-full object-cover" : "size-full object-contain p-[12%]"} />
      </span>
    )
  }
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  return <span className={cn(tile, "bg-elevated font-bold text-foreground")}>{initials}</span>
}

/** "Sauvignon Blanc" wordmark with the B&B endorsement. */
export function AppMark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-lime font-heading text-lg leading-none text-ink" aria-hidden>
        S
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-heading text-[17px] text-foreground">Sauvignon Blanc</span>
          <span className="block text-[9px] tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase">by Bordeaux &amp; Burgundy</span>
        </span>
      )}
    </span>
  )
}

/** A person's profile picture, or their initials on a round tile. */
export function Avatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  const initials = name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  if (url) return <img src={url} alt="" className={cn("inline-block size-8 shrink-0 rounded-full object-cover ring-1 ring-border", className)} />
  return <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-bold ring-1 ring-border", className)}>{initials}</span>
}
