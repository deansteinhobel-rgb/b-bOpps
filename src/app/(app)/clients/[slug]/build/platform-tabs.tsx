import Link from "next/link"
import { PlatformIcon, type AnyPlatform } from "@/components/brand"
import { BUILD_PLATFORM_LABEL, type BuildPlatform } from "@/lib/campaign-builder/platform-plan"
import { cn } from "@/lib/utils"

const ICON: Record<BuildPlatform, AnyPlatform> = { linkedin: "linkedin", google_ads: "google_ads", meta: "meta", reddit: "reddit", microsoft_ads: "bing" }

/**
 * Which platform the builder works on (`?platform=`). Platforms the client has no ad account on are
 * shown, dimmed, with why: Microsoft Ads waits until its reporting is connected.
 */
export function PlatformTabs({ slug, current, available }: { slug: string; current: BuildPlatform; available: Record<BuildPlatform, string | null> }) {
  return (
    <nav aria-label="Platform" className="flex flex-wrap gap-2">
      {(Object.keys(BUILD_PLATFORM_LABEL) as BuildPlatform[]).map((p) => {
        const why = available[p]
        const body = (
          <>
            <PlatformIcon platform={ICON[p]} />
            {BUILD_PLATFORM_LABEL[p]}
          </>
        )
        if (why) {
          return (
            <span key={p} title={why} aria-disabled className="pill gap-1.5 opacity-50">
              {body}
            </span>
          )
        }
        return (
          <Link key={p} href={`/clients/${slug}/build${p === "linkedin" ? "" : `?platform=${p}`}`} aria-current={p === current ? "page" : undefined} className={cn("pill gap-1.5 hover:text-foreground", p === current && "pill-active text-foreground")}>
            {body}
          </Link>
        )
      })}
    </nav>
  )
}
