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
    <nav aria-label="Platform" className="-mx-2 flex flex-wrap">
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
            <span key={p} title={why} aria-disabled className="flex h-8 items-center gap-1.5 px-2 text-[13px] text-muted-foreground opacity-50">
              {body}
            </span>
          )
        }
        return (
          <Link key={p} href={`/clients/${slug}/build${p === "linkedin" ? "" : `?platform=${p}`}`} aria-current={p === current ? "page" : undefined} className={cn("flex h-8 items-center rounded-sm px-2 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", p === current ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {/* The current platform carries the app's one selection mark. */}
            <span className={cn("flex h-full items-center gap-1.5", p === current && "select-line")}>{body}</span>
          </Link>
        )
      })}
    </nav>
  )
}
