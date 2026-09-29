/** Colour and wording rules shared by At a glance (plain module: used by server and client components). */

/** Green on target, amber within 20% over, red further off. */
export const cprTone = (cpr: number | null, target: number | null) =>
  cpr === null || target === null ? "text-muted-foreground" : cpr <= target ? "text-rag-green" : cpr <= target * 1.2 ? "text-rag-amber" : "text-rag-red"

/** Within 10% of pace is fine, 10–20% off is amber, further (or past the whole budget) is red. */
export const paceTone = (spend: number, expected: number | null, budget?: number | null) => {
  if (!expected) return "bg-foreground/40"
  if (budget && spend > budget) return "bg-rag-red"
  const off = Math.abs(spend / expected - 1)
  return off > 0.2 ? "bg-rag-red" : off > 0.1 ? "bg-rag-amber" : "bg-rag-green"
}

/** Pacing in plain words: "on pace", "spending 27% faster than planned", "spending 20% slower than planned", "already 2% over the month's budget". */
export function paceWords(spend: number, expected: number | null, budget?: number | null) {
  if (!expected) return null
  if (budget && spend > budget) return `already ${Math.max(1, Math.round((spend / budget - 1) * 100))}% over the month's budget`
  const r = spend / expected
  if (Math.abs(r - 1) <= 0.1) return "on pace"
  return r > 1 ? `spending ${Math.round((r - 1) * 100)}% faster than planned` : `spending ${Math.round((1 - r) * 100)}% slower than planned`
}
