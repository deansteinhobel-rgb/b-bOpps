"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

/**
 * A thin lime bar across the top while the next page loads (Dean, 2026-10-15: "display a loading icon when we
 * are loading stuff"). It starts on a click on an internal link and finishes when the URL changes. Sections that
 * load after the page shows have their own spinner (SectionLoading).
 */
export function NavProgress() {
  const pathname = usePathname()
  const params = useSearchParams()
  const query = params.toString()
  const here = `${pathname}${query ? `?${query}` : ""}`
  // The URL we were on when a link was clicked: while we're still there the next page is loading; once the URL
  // has moved on, it's in.
  const [from, setFrom] = useState<string | null>(null)
  const phase = from === null ? "idle" : from === here ? "loading" : "done"
  const safety = useRef<number | undefined>(undefined)

  // Fade the finished bar out, then reset.
  useEffect(() => {
    if (phase !== "done") return
    const t = window.setTimeout(() => setFrom(null), 400)
    return () => window.clearTimeout(t)
  }, [phase])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.("a")
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const current = window.location.pathname + window.location.search
      if (url.pathname + url.search === current) return // same page, or just a #hash
      setFrom(current)
      window.clearTimeout(safety.current)
      safety.current = window.setTimeout(() => setFrom(null), 20000) // never stuck on screen
    }
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("click", onClick, true)
      window.clearTimeout(safety.current)
    }
  }, [])

  // Always mounted, so the bar grows from nothing instead of appearing half-full.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-px" role={phase === "loading" ? "progressbar" : undefined} aria-label={phase === "loading" ? "Loading the page" : undefined} aria-hidden={phase !== "loading"}>
      <div
        className="h-full bg-lime transition-[width,opacity] ease-out"
        style={{
          width: phase === "idle" ? "0%" : phase === "loading" ? "85%" : "100%",
          opacity: phase === "loading" ? 1 : 0,
          transitionDuration: phase === "idle" ? "0s, 0s" : phase === "loading" ? "8s, 0.15s" : "0.2s, 0.4s",
        }}
      />
    </div>
  )
}
