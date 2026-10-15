import { Loader2Icon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Loading states (Dean, 2026-10-15: "display a loading icon when we are loading stuff"). Pages show their
 * quick parts straight away and each slower section streams in behind a SectionLoading placeholder.
 */
export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2Icon role="status" aria-label={label} className={cn("size-4 shrink-0 animate-spin text-primary", className)} />
}

/** A section that's still loading: a spinner and what it's loading, over a faint outline of the content. */
export function SectionLoading({ label, className, lines = 3 }: { label: string; className?: string; lines?: number }) {
  return (
    <div className={cn("surface space-y-4 p-5", className)} aria-busy="true">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label={label} />
        {label}
      </p>
      <div className="space-y-2.5" aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-3.5", i % 3 === 0 ? "w-11/12" : i % 3 === 1 ? "w-3/4" : "w-1/2")} />
        ))}
      </div>
    </div>
  )
}
