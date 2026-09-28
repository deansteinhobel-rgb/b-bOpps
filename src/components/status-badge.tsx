import { cn } from "@/lib/utils"

export type Rag = "green" | "amber" | "red" | "na" | "no_budget"

const STYLE: Record<Rag, { name: string; className: string; dot: string }> = {
  green: { name: "Green", className: "bg-rag-green-bg text-rag-green ring-rag-green/30", dot: "bg-rag-green" },
  amber: { name: "Amber", className: "bg-rag-amber-bg text-rag-amber ring-rag-amber/30", dot: "bg-rag-amber" },
  red: { name: "Red", className: "bg-rag-red-bg text-rag-red ring-rag-red/30", dot: "bg-rag-red" },
  na: { name: "N/A", className: "bg-rag-na-bg text-rag-na ring-rag-na/30", dot: "bg-rag-na" },
  no_budget: { name: "No budget", className: "bg-rag-na-bg text-rag-na ring-rag-na/30", dot: "bg-rag-na" },
}

/**
 * Status in colour. Green/amber/red show the colour alone (Dean: no need to spell it out); the name is
 * kept for screen readers and as a tooltip. Pass `label` to add words (e.g. "Proven", "On target").
 */
export function StatusBadge({ status, label, className }: { status: Rag; label?: string; className?: string }) {
  const s = STYLE[status]
  const words = label ?? (status === "na" || status === "no_budget" ? s.name : null)
  if (!words) {
    return (
      <span className={cn("inline-flex size-5 items-center justify-center rounded-full ring-1", s.className, className)} title={s.name} role="img" aria-label={s.name}>
        <span aria-hidden className={cn("size-2 rounded-full", s.dot)} />
      </span>
    )
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", s.className, className)} title={label ? s.name : undefined}>
      <span aria-hidden className={cn("size-1.5 rounded-full", s.dot)} />
      {words}
    </span>
  )
}

/** Just the coloured dot, for dense rows. */
export function StatusDot({ status, className }: { status: Rag; className?: string }) {
  return <span role="img" aria-label={STYLE[status].name} title={STYLE[status].name} className={cn("inline-block size-2 shrink-0 rounded-full", STYLE[status].dot, className)} />
}
