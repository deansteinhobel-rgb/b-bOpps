"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

// Small line icons (16px grid), one per section.
const ICON: Record<string, React.ReactNode> = {
  Overview: <path d="M2.5 2.5h4.5v5h-4.5zM9 2.5h4.5v3H9zM9 7.5h4.5v6H9zM2.5 9.5h4.5v4h-4.5z" />,
  Performance: <path d="M2 13.5h12M3.5 11l3-3.5 2.5 2 3.5-5" />,
  "Optimise now": <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" />,
  Checks: <path d="m3 8.5 3 3 7-7" />,
  Sprint: <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3" />,
  Briefs: <path d="M4 1.5h5.5L12.5 4.5v10H4zM9 1.5v3.5h3.5M6 8h4.5M6 10.5h4.5" />,
  Brain: <path d="M6 2.5a2.2 2.2 0 0 0-2.2 2.2 2.3 2.3 0 0 0-1.3 2.1c0 .9.5 1.6 1.2 2a2.4 2.4 0 0 0 2.3 3.2V2.5ZM10 2.5a2.2 2.2 0 0 1 2.2 2.2 2.3 2.3 0 0 1 1.3 2.1c0 .9-.5 1.6-1.2 2a2.4 2.4 0 0 1-2.3 3.2V2.5ZM6 2.5h4M6 12h4" />,
}

const TABS = [
  { href: "", label: "Overview" },
  { href: "/performance", label: "Performance" },
  { href: "/insights", label: "Optimise now" },
  { href: "/checks", label: "Checks" },
  { href: "/sprint", label: "Sprint" },
  { href: "/briefs", label: "Briefs" },
  { href: "/brain", label: "Brain" },
]

/**
 * The client's section tabs: an icon and label per tab, a lime underline that slides to the active
 * one, and a soft hover. The active tab follows the URL straight away on click.
 */
export function ClientTabs({ slug }: { slug: string }) {
  const pathname = usePathname()
  const base = `/clients/${slug}`
  const activeFor = (path: string) => TABS.find((t) => t.href && path.startsWith(base + t.href))?.label ?? (path === base ? "Overview" : null)
  const [clicked, setClicked] = useState<{ label: string; from: string } | null>(null)
  // A click shows straight away; once the URL changes, the URL decides again.
  const active = clicked && clicked.from === pathname ? clicked.label : activeFor(pathname)

  const nav = useRef<HTMLElement>(null)
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = active ? refs.current[active] : null
    if (!el) return
    const measure = () => setBar({ left: el.offsetLeft, width: el.offsetWidth })
    measure()
    el.scrollIntoView({ block: "nearest", inline: "nearest" })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])

  return (
    <nav ref={nav} className="relative -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Client sections">
      {TABS.map((t) => {
        const href = base + t.href
        const isActive = active === t.label
        return (
          <Link
            key={t.label}
            ref={(el) => {
              refs.current[t.label] = el
            }}
            href={href}
            onClick={() => setClicked({ label: t.label, from: pathname })}
            aria-current={isActive ? "page" : undefined}
            className="group relative pb-2.5 text-sm whitespace-nowrap"
          >
            <span
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors",
                isActive ? "font-medium text-foreground" : "text-muted-foreground group-hover:bg-secondary/70 group-hover:text-foreground",
              )}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={cn("size-4 shrink-0 transition-colors", isActive ? "text-lime" : "text-muted-foreground/80 group-hover:text-foreground")} aria-hidden>
                {ICON[t.label]}
              </svg>
              {t.label}
            </span>
          </Link>
        )
      })}
      {bar && <span className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-lime transition-all duration-300 ease-out motion-reduce:transition-none" style={{ left: bar.left + 6, width: bar.width - 12 }} aria-hidden />}
    </nav>
  )
}
