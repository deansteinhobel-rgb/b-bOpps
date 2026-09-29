import Link from "next/link"
import { PlatformIcon } from "@/components/brand"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cn } from "@/lib/utils"

export const PERIODS = [7, 14, 30, 90] as const
export const parseDays = (v: unknown) => (PERIODS as readonly number[]).includes(Number(v)) ? Number(v) : 30
export const parsePlatform = (v: unknown): Platform | null => (v === "linkedin" || v === "google_ads" || v === "meta" ? v : null)

/** Period and platform filters, in one row above the charts (links, so the URL holds the view). */
export function Controls({ base, days, platform, platforms, from, to }: { base: string; days: number; platform: Platform | null; platforms?: Platform[]; from: string; to: string }) {
  const href = (d: number, p: Platform | null) => {
    const q = new URLSearchParams()
    if (d !== 30) q.set("days", String(d))
    if (p) q.set("platform", p)
    return `${base}${q.size ? `?${q}` : ""}`
  }
  const pill = (active: boolean) => cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors", active ? "border-foreground/25 bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border p-0.5" role="group" aria-label="Period">
          {PERIODS.map((d) => (
            <Link key={d} href={href(d, platform)} aria-current={d === days ? "page" : undefined} className={cn("rounded-full px-3 py-1 text-xs", d === days ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {d} days
            </Link>
          ))}
        </div>
        {platforms && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Platform">
            <Link href={href(days, null)} className={pill(!platform)}>
              All platforms
            </Link>
            {platforms.map((p) => (
              <Link key={p} href={href(days, p)} className={pill(platform === p)}>
                <PlatformIcon platform={p} className="size-3.5" /> {PLATFORM_LABEL[p]}
              </Link>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {day(from)} – {day(to)} vs the {days} days before
      </p>
    </div>
  )
}
