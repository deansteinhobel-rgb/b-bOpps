import { cn } from "@/lib/utils"

export type Rag = "green" | "amber" | "red" | "na" | "no_budget"

const STYLE: Record<Rag, { label: string; className: string }> = {
  green: { label: "Green", className: "bg-rag-green-bg text-rag-green" },
  amber: { label: "Amber", className: "bg-rag-amber-bg text-rag-amber" },
  red: { label: "Red", className: "bg-rag-red-bg text-rag-red" },
  na: { label: "N/A", className: "bg-rag-na-bg text-rag-na" },
  no_budget: { label: "No budget", className: "bg-rag-na-bg text-rag-na" },
}

/** Red/amber/green status. Colours are deliberately not the lime brand accent. */
export function StatusBadge({ status, label, className }: { status: Rag; label?: string; className?: string }) {
  const s = STYLE[status]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold", s.className, className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label ?? s.label}
    </span>
  )
}
