/* eslint-disable @next/next/no-img-element -- small brand images from Supabase Storage */
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"

/** Simplified platform marks, sized to sit inline with text. */
export function PlatformIcon({ platform, className }: { platform: Platform | null; className?: string }) {
  const cls = cn("inline-block size-4 shrink-0", className)
  if (platform === "linkedin") {
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-hidden>
        <rect width="24" height="24" rx="5" fill="#0A66C2" />
        <path fill="#fff" d="M7.1 9.6h2.6V18H7.1zM8.4 5.4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM11.3 9.6h2.5v1.2h.04c.35-.66 1.2-1.36 2.47-1.36 2.64 0 3.13 1.74 3.13 4V18h-2.6v-4c0-.95-.02-2.18-1.33-2.18-1.33 0-1.53 1.04-1.53 2.1V18h-2.6z" />
      </svg>
    )
  }
  if (platform === "google_ads") {
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-hidden>
        <path fill="#FBBC04" d="M9.2 3.6a3.4 3.4 0 0 1 4.65 1.25l6.2 10.73a3.4 3.4 0 1 1-5.9 3.4L7.96 8.25A3.4 3.4 0 0 1 9.2 3.6z" />
        <path fill="#4285F4" d="M8.04 8.2 3.95 15.3a3.4 3.4 0 1 0 5.9 3.4l4.1-7.1z" />
        <circle cx="6.9" cy="17" r="3.4" fill="#34A853" />
      </svg>
    )
  }
  if (platform === "meta") {
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-hidden>
        <path
          fill="#0081FB"
          d="M6.3 6.5c-2.6 0-4.3 3.3-4.3 6.4 0 2.4 1.2 4.1 3.2 4.1 1.6 0 2.8-.9 4.6-3.9l1.3-2.2.4-.7c1.5-2.4 2.7-3.7 4.3-3.7 2.4 0 4.2 3.2 4.2 6.2 0 1.9-.8 3-2.1 3-1.3 0-2-.9-3.8-3.9l-.9-1.5-1 1.6c1.9 3 3.3 4.8 5.6 4.8 2.7 0 4.2-2.3 4.2-5.6 0-4.4-2.7-8.5-6.2-8.5-2.1 0-3.7 1.5-5.3 4l-.5.8-.7-1.1C9.8 7.8 8.3 6.5 6.3 6.5zm.1 2c1.1 0 2 .9 3.6 3.4l.4.6-1.5 2.4C7.6 17 7 17.4 6 17.4c-1 0-1.9-.9-1.9-2.6 0-2.8 1.2-6.3 2.3-6.3z"
        />
      </svg>
    )
  }
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
    return (
      <span className={tile}>
        <img src={logoUrl} alt="" className="size-full object-contain p-[12%]" />
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
