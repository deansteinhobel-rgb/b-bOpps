import "server-only"
import { createHash, timingSafeEqual } from "node:crypto"

const digest = (s: string) => createHash("sha256").update(s).digest()

/**
 * Whether a request carries `Authorization: Bearer $CRON_SECRET` (Supabase Cron and Vercel cron).
 * Compared in constant time; refuses everything when the secret isn't set.
 */
export function isCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))
}
