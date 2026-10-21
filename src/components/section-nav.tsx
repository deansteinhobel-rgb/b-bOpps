"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * A long page's jump bar (At a glance, Reporting): one link per section, sticky under the top bar, with the section
 * you're reading highlighted.
 */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string | undefined>(sections[0]?.id)
  useEffect(() => {
    // The section being read is the last one whose top has passed just under the bar.
    const onScroll = () => {
      let current: string | undefined = sections[0]?.id
      for (const s of sections) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= 160) current = s.id
      }
      // At the very bottom, the last section counts even if it's short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections.at(-1)?.id
      setActive(current)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [sections])

  return (
    <nav aria-label="Sections" className="sticky top-[69px] z-20 -mx-2 flex overflow-x-auto bg-background [scrollbar-width:none] lg:top-0">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? "location" : undefined}
          onClick={() => setActive(s.id)}
          className={cn(
            "flex h-9 items-center rounded-sm px-2 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === s.id ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {/* The section being read gets the app's one selection mark, the 1px lime line. */}
          <span className={cn("flex h-full items-center", active === s.id && "select-line")}>{s.label}</span>
        </a>
      ))}
    </nav>
  )
}
