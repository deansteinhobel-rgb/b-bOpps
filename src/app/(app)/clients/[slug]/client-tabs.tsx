"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useLayoutEffect, useRef, useState } from "react"
import type { TabGroup } from "@/lib/tab-groups"
import { cn } from "@/lib/utils"

type Box = { left: number; width: number }

/**
 * A client's navigation (Dean, 2026-10-15: one clear primary level, sub-pages that look like sub-pages).
 * Three levels, three looks: sections (Summary, Tasks, Reporting, Planning, Knowledge) are tabs on a
 * hairline with a lime underline that slides to the active one (the page's "you are here"); a section
 * with several pages (Tasks, Planning) shows them as a compact view switcher under it; filters inside a
 * page are flat text (FilterTabs). So no two levels look alike.
 */
export function ClientTabs({ slug, groups }: { slug: string; groups: TabGroup[] }) {
  const pathname = usePathname()
  const base = `/clients/${slug}`
  const matches = (path: string, href: string) => (href ? path === base + href || path.startsWith(`${base + href}/`) : path === base)
  const groupFor = (path: string) => groups.find((g) => g.items.some((i) => i.href && matches(path, i.href))) ?? groups.find((g) => g.items.some((i) => i.href === "" && path === base)) ?? null
  // The clicked tab shows as active straight away, then the URL catches up.
  const [clicked, setClicked] = useState<{ key: string; from: string } | null>(null)
  const active = clicked && clicked.from === pathname ? groups.find((g) => g.key === clicked.key) ?? null : groupFor(pathname)

  const refs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [bar, setBar] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const el = active ? refs.current[active.key] : null
    if (!el) return setBar(null)
    const measure = () => setBar({ left: el.offsetLeft, width: el.offsetWidth })
    measure()
    el.scrollIntoView({ block: "nearest", inline: "nearest" })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])

  const sub = active && active.items.length > 1 ? active : null
  return (
    <div className="space-y-5">
      <nav className="relative overflow-x-auto border-b [scrollbar-width:none]" aria-label="Client sections">
        <div className="relative flex gap-7">
          {groups.map((g) => {
            const on = active?.key === g.key
            return (
              <Link
                key={g.key}
                ref={(el) => {
                  refs.current[g.key] = el
                }}
                href={base + g.items[0].href}
                onClick={() => setClicked({ key: g.key, from: pathname })}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center rounded-sm text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  on ? "font-medium text-foreground" : "text-body hover:text-foreground",
                )}
              >
                {g.label}
              </Link>
            )
          })}
          {bar && <span className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-lime transition-all duration-200 ease-out motion-reduce:transition-none" style={bar} aria-hidden />}
        </div>
      </nav>
      {sub && (
        <nav className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-white/[0.04] p-0.5 [scrollbar-width:none]" aria-label={`${sub.label} pages`}>
          {sub.items.map((i) => {
            // The most specific page wins: Client report (/reporting/client-report) isn't also Dashboard (/reporting).
            const on = matches(pathname, i.href) && !sub.items.some((o) => o.href.length > i.href.length && matches(pathname, o.href))
            return (
              <Link
                key={i.href}
                href={base + i.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center rounded-md px-3 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-white/[0.1] font-medium text-foreground" : "text-body hover:text-foreground",
                )}
              >
                {i.label}
              </Link>
            )
          })}
        </nav>
      )}
    </div>
  )
}
