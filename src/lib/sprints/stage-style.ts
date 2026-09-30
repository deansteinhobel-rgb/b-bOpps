import type { Stage } from "./tests"

/**
 * Each board stage's colour (Dean, 2026-09-30: easier to scan). Brand secondaries and neutrals,
 * never lime (that's for actions) and not RAG on its own, so a stage never reads as good or bad.
 * A plain module: the server page and the client card both use it.
 */
export const STAGE_STYLE: Record<Stage, { dot: string; bar: string; ring: string; empty: string }> = {
  planned: { dot: "bg-rag-na", bar: "bg-rag-na/60", ring: "ring-rag-na/25", empty: "Plan a test to get the sprint going." },
  in_production: { dot: "bg-lavender", bar: "bg-lavender/70", ring: "ring-lavender/25", empty: "Nothing with the team yet." },
  ready: { dot: "bg-violet", bar: "bg-violet/80", ring: "ring-violet/30", empty: "Nothing waiting to launch." },
  live: { dot: "bg-rag-green", bar: "bg-rag-green/70", ring: "ring-rag-green/25", empty: "Nothing live yet." },
  review: { dot: "bg-rag-amber", bar: "bg-rag-amber/70", ring: "ring-rag-amber/25", empty: "Nothing to call yet." },
  done: { dot: "bg-muted-foreground", bar: "bg-muted-foreground/50", ring: "ring-border", empty: "" },
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

/** "Due in 2d", "3d overdue", "Due 16 Oct": relative when it's close, coloured when it needs attention. */
export function dueChip(due: string | null, today: string) {
  if (!due) return null
  const d = dayDiff(today, due)
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(due))
  if (d < 0) return { text: `${-d}d overdue`, title: `Due ${date}`, tone: "bg-rag-red-bg text-rag-red ring-rag-red/30" }
  if (d === 0) return { text: "Due today", title: `Due ${date}`, tone: "bg-rag-amber-bg text-rag-amber ring-rag-amber/30" }
  if (d <= 3) return { text: `Due in ${d}d`, title: `Due ${date}`, tone: "bg-rag-amber-bg text-rag-amber ring-rag-amber/30" }
  return { text: `Due ${date}`, title: `Due ${date}`, tone: "bg-secondary text-muted-foreground ring-border" }
}

export const daysSince = (from: string, today: string) => dayDiff(from, today)
