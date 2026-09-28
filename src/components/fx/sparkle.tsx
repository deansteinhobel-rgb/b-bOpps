import { cn } from "@/lib/utils"

// Fixed "random" layout so server and client render the same specks.
const rand = (i: number, n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1
const DOTS = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + rand(i, 1) * 0.3
  const spread = 1 + rand(i, 2) * 0.18
  // Rounded, so the server-rendered HTML and the browser agree exactly (no hydration mismatch).
  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    left: `${r2(50 + Math.cos(angle) * 56 * spread)}%`,
    top: `${r2(50 + Math.sin(angle) * 78 * spread)}%`,
    size: `${r2(1.5 + rand(i, 3) * 2.5)}px`,
    delay: `${r2(-rand(i, 4) * 2.5)}s`,
    duration: `${r2(1.8 + rand(i, 5) * 1.8)}s`,
  }
})

/**
 * Lime specks that gather in a ring around an element on hover, like the website's "Say hello"
 * button. Pure CSS (`sparkle-float` in globals.css). Hidden when reduced motion is on.
 */
export function Sparkle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("group/sparkle relative inline-flex", className)}>
      {children}
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/sparkle:opacity-100 motion-reduce:hidden">
        {DOTS.map((d, i) => (
          <span
            key={i}
            className="sparkle-float absolute rounded-full bg-lime"
            style={{ left: d.left, top: d.top, width: d.size, height: d.size, animationDelay: d.delay, animationDuration: d.duration }}
          />
        ))}
      </span>
    </span>
  )
}
