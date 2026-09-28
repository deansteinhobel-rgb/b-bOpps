"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "", label: "Overview" },
  { href: "/checks", label: "Checks" },
  { href: "/sprint", label: "Sprint" },
  { href: "/briefs", label: "Briefs" },
]

export function ClientTabs({ slug }: { slug: string }) {
  const pathname = usePathname()
  const base = `/clients/${slug}`
  return (
    <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Client sections">
      {TABS.map((t) => {
        const href = base + t.href
        const active = t.href ? pathname.startsWith(href) : pathname === base
        return (
          <Link
            key={t.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 pb-3 text-sm whitespace-nowrap transition-colors",
              active ? "border-ink font-bold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
