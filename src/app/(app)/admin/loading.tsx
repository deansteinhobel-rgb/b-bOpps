import { Spinner } from "@/components/loading"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label="Loading…" />
        Loading…
      </p>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-48 rounded-lg" />
      <Skeleton className="h-48 rounded-lg" />
    </div>
  )
}
