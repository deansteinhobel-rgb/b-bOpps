import type { PageText } from "@/lib/content-library/page-text"
import type { Placement } from "@/lib/content-library/suggestions"

/** Browser calls to /api/content-library. Each throws the server's message on failure. */
async function post<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch("/api/content-library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal })
  // Signed out: the proxy sends the login page instead of JSON.
  if (res.redirected || !(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error("You've been signed out. Reload the page and sign in again.")
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.")
  return data
}

export type Signed = { payload: string; sig: string }

export const readPage = (clientSlug: string, url: string) => post<{ page: PageText }>({ action: "read_page", clientSlug, url })

export const suggestPlacement = (clientSlug: string, piece: { title: string; url: string | null; type: string; audiences: string[]; notes: string; pageDescription?: string; pageText?: string }, signal: AbortSignal) =>
  post<{ code: string; placement: Placement; signed: Signed }>({ action: "suggest", clientSlug, piece }, signal)

export const askAgain = (clientSlug: string, pieceId: string) => post<{ changed: number; kept: number }>({ action: "reask", clientSlug, pieceId })

export const rewriteAngle = (clientSlug: string, pieceId: string, slot: 1 | 2 | 3) => post<{ angle: string }>({ action: "angle", clientSlug, pieceId, slot })
