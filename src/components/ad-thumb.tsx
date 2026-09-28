/* eslint-disable @next/next/no-img-element -- signed, short-lived Supabase Storage URLs; next/image adds nothing here */
import type { Preview } from "@/lib/previews"
import { cn } from "@/lib/utils"

const SIZE = { sm: "size-10", md: "size-16", lg: "size-28" } as const

/** Saved preview image, a "Text ad" tile for search ads, or an empty tile. Meta ads link to the real preview. */
export function AdThumb({ preview, alt, size = "md", className }: { preview?: Preview; alt: string; size?: keyof typeof SIZE; className?: string }) {
  const tile = cn("shrink-0 overflow-hidden rounded-md border bg-secondary", SIZE[size], className)
  const img = preview?.src ? (
    <img src={preview.src} alt={alt} loading="lazy" className={cn(tile, "object-cover")} />
  ) : (
    <span className={cn(tile, "flex items-center justify-center p-1 text-center text-[10px] leading-tight text-muted-foreground")} aria-label={preview?.textOnly ? "Text ad, no image" : "No preview"}>
      {preview?.textOnly ? "Text ad" : "No preview"}
    </span>
  )
  if (!preview?.link) return img
  return (
    <a href={preview.link} target="_blank" rel="noreferrer" title="View the ad in Meta" className="shrink-0">
      {img}
    </a>
  )
}

export function ViewAdLink({ preview }: { preview?: Preview }) {
  if (!preview?.link) return null
  return (
    <a href={preview.link} target="_blank" rel="noreferrer" className="text-xs underline">
      View ad
    </a>
  )
}
