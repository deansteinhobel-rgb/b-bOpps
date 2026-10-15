import { Spinner } from "@/components/loading"
import { Skeleton } from "@/components/ui/skeleton"

/** Shown instantly when switching tabs, while the server loads the tab (the tab bar stays put). */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label="Loading this tab…" />
        Loading this tab…
      </p>
      <Skeleton className="h-7 w-56" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
