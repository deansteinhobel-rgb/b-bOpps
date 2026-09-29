"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * The Account tab's jump bar: one link per section, sticky under the top bar, with the section
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
    <nav aria-label="Sections" className="sticky top-[57px] z-20 -mx-1 flex gap-1 overflow-x-auto bg-background/90 px-1 py-2 backdrop-blur [scrollbar-width:none] lg:top-0">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? "location" : undefined}
          onClick={() => setActive(s.id)}
          className={cn(
            "rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors",
            active === s.id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  )
}
