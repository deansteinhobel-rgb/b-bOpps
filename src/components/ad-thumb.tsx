"use client"
/* eslint-disable @next/next/no-img-element -- signed, short-lived Supabase Storage URLs; next/image adds nothing here */
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import type { Preview } from "@/lib/previews"
import { cn } from "@/lib/utils"

const SIZE = { sm: "size-10", md: "size-16", lg: "size-28" } as const

/**
 * Saved preview image, a "Text ad" tile for search ads, or an empty tile. Hovering an image shows
 * it large; Meta ads also link to Meta's real preview.
 */
export function AdThumb({ preview, alt, size = "md", className }: { preview?: Preview; alt: string; size?: keyof typeof SIZE; className?: string }) {
  const tile = cn("shrink-0 overflow-hidden rounded-md border bg-elevated", SIZE[size], className)
  if (!preview?.src) {
    return (
      <span className={cn(tile, "flex items-center justify-center p-1 text-center text-[10px] leading-tight text-muted-foreground")} aria-label={preview?.textOnly ? "Text ad, no image" : "No preview"}>
        {preview?.textOnly ? "Text ad" : "No preview"}
      </span>
    )
  }
  const image = <img src={preview.src} alt={alt} loading="lazy" className={cn(tile, "object-cover transition-opacity hover:opacity-90")} />
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        render={preview.link ? <a href={preview.link} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`${alt}: view the ad in Meta`} /> : <span className="shrink-0" tabIndex={0} />}
      >
        {image}
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-[min(380px,85vw)] border-border bg-popover p-2">
        <img src={preview.src} alt={alt} className="max-h-[70vh] w-full rounded-md object-contain" />
        <p className="mt-2 line-clamp-2 px-1 text-xs text-muted-foreground">{alt}</p>
        {preview.link && <p className="px-1 pb-1 text-xs text-foreground">Click to open the ad in Meta</p>}
      </HoverCardContent>
    </HoverCard>
  )
}

export function ViewAdLink({ preview }: { preview?: Preview }) {
  if (!preview?.link) return null
  return (
    <a href={preview.link} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline hover:text-foreground">
      View ad
    </a>
  )
}
