"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useLayoutEffect, useRef, useState } from "react"
import type { TabGroup } from "@/lib/lens"
import { cn } from "@/lib/utils"

// The classic layout's tabs. The new layout passes `groups` instead (src/lib/lens.ts).
const TABS = [
  { href: "", label: "At a glance" },
  { href: "/reporting", label: "Reporting" },
  { href: "/insights", label: "Optimize now" },
  { href: "/checks", label: "Checks" },
  { href: "/sprint", label: "Sprint" },
  { href: "/briefs", label: "Briefs" },
  { href: "/brain", label: "Brain" },
]

type Box = { left: number; width: number }

type Tab = { href: string; label: string; match: string[] }
const classicTabs: Tab[] = TABS.map((t) => ({ ...t, match: [t.href] }))
const groupTabs = (groups: TabGroup[]): Tab[] => groups.map((g) => ({ href: g.items[0].href, label: g.label, match: g.items.map((i) => i.href) }))

/**
 * The client's section tabs, Stripe style (Dean): a lime pill sits behind the active tab and slides
 * to the next one on click, and a soft pill follows the pointer on hover. The active tab follows the
 * click straight away, then the URL. In the new layout each tab is a group (Do, Overview, Performance,
 * Plan, Know); a group with several pages gets a quiet second row under it.
 */
export function ClientTabs({ slug, groups }: { slug: string; groups?: TabGroup[] }) {
  const pathname = usePathname()
  const base = `/clients/${slug}`
  const tabs = groups ? groupTabs(groups) : classicTabs
  const matches = (path: string, href: string) => (href ? path === base + href || path.startsWith(`${base + href}/`) : path === base)
  const activeFor = (path: string) => tabs.find((t) => t.match.some((m) => m && matches(path, m)))?.label ?? tabs.find((t) => t.match.includes("") && path === base)?.label ?? null
  const [clicked, setClicked] = useState<{ label: string; from: string } | null>(null)
  const active = clicked && clicked.from === pathname ? clicked.label : activeFor(pathname)

  const refs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const box = (label: string | null): Box | null => {
    const el = label ? refs.current[label] : null
    return el ? { left: el.offsetLeft, width: el.offsetWidth } : null
  }
  const [pill, setPill] = useState<Box | null>(null)
  const [hover, setHover] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const el = active ? refs.current[active] : null
    if (!el) return setPill(null)
    const measure = () => setPill({ left: el.offsetLeft, width: el.offsetWidth })
    measure()
    el.scrollIntoView({ block: "nearest", inline: "nearest" })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])

  const main = (
    <nav className="relative -mx-1 flex overflow-x-auto px-1 pb-3 [scrollbar-width:none]" aria-label="Client sections" onMouseLeave={() => setHover(null)}>
      <div className="relative flex">
        {/* Hover pill: follows the pointer, hidden over the active tab. */}
        <span
          className={cn("pointer-events-none absolute inset-y-0 rounded-full bg-secondary transition-all duration-200 ease-out motion-reduce:transition-none", hover ? "opacity-100" : "opacity-0")}
          style={hover ?? pill ?? { left: 0, width: 0 }}
          aria-hidden
        />
        {/* Active pill. */}
        {pill && <span className="pointer-events-none absolute inset-y-0 rounded-full bg-lime transition-all duration-300 ease-[cubic-bezier(0.3,1.3,0.5,1)] motion-reduce:transition-none" style={pill} aria-hidden />}
        {tabs.map((t) => {
          const isActive = active === t.label
          return (
            <Link
              key={t.label}
              ref={(el) => {
                refs.current[t.label] = el
              }}
              href={base + t.href}
              onClick={() => setClicked({ label: t.label, from: pathname })}
              onMouseEnter={() => setHover(isActive ? null : box(t.label))}
              onFocus={() => setHover(isActive ? null : box(t.label))}
              onBlur={() => setHover(null)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative z-10 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-lime/60",
                isActive ? "font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
  const group = groups?.find((g) => g.label === active)
  const sub = group && group.items.length > 1 && (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-3 [scrollbar-width:none]" aria-label={`${group.label} pages`}>
      {group.items.map((i) => {
        const on = matches(pathname, i.href)
        return (
          <Link key={i.href} href={base + i.href} aria-current={on ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors", on ? "pill-active font-medium" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground")}>
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
  return (
    <>
      {main}
      {sub}
    </>
  )
}
