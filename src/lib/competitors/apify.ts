import "server-only"
import { fetchFrom, readBytes } from "@/lib/windsor/creatives"

/**
 * A minimal Apify client: start an actor run, check it, read its dataset. Only api.apify.com, only
 * the actors listed in `sources.ts` (callers pass those). The token stays server-side.
 */
const HOSTS = ["api.apify.com"]
const BASE = "https://api.apify.com/v2"
const MAX_BODY = 20 * 1024 * 1024

export const apifyConfigured = () => Boolean(process.env.APIFY_TOKEN)

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error("APIFY_TOKEN is not set")
  const res = await fetchFrom(HOSTS, `${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  })
  const text = new TextDecoder().decode(await readBytes(res, MAX_BODY, "Apify response is too large"))
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Apify HTTP ${res.status}: not JSON`)
  }
  if (!res.ok) {
    const err = (body as { error?: { type?: string; message?: string } }).error
    const e = new Error(`Apify HTTP ${res.status}: ${err?.message ?? "error"}`.slice(0, 300)) as Error & { type?: string }
    e.type = err?.type
    throw e
  }
  return body as T
}

export type ApifyRun = { id: string; status: string; defaultDatasetId: string; usageTotalUsd?: number }
export const FINISHED = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]

/** Starts a run and returns at once (runs take 10 seconds to a few minutes). */
export async function startRun(actor: string, input: Record<string, unknown>): Promise<ApifyRun> {
  if (!/^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+$/.test(actor)) throw new Error("Bad actor id")
  return (await call<{ data: ApifyRun }>(`/acts/${actor}/runs?timeout=600`, { method: "POST", body: JSON.stringify(input) })).data
}

export async function runStatus(runId: string): Promise<ApifyRun> {
  if (!/^[A-Za-z0-9]+$/.test(runId)) throw new Error("Bad run id")
  return (await call<{ data: ApifyRun }>(`/actor-runs/${runId}`)).data
}

/** Every item in a run's dataset, a page at a time, up to `max`. */
export async function datasetItems(datasetId: string, max = 1000): Promise<unknown[]> {
  if (!/^[A-Za-z0-9]+$/.test(datasetId)) throw new Error("Bad dataset id")
  const out: unknown[] = []
  for (let offset = 0; out.length < max; offset += 250) {
    const page = await call<unknown[]>(`/datasets/${datasetId}/items?clean=1&offset=${offset}&limit=250`)
    if (!Array.isArray(page) || !page.length) break
    out.push(...page)
    if (page.length < 250) break
  }
  return out.slice(0, max)
}

/** Whether Apify refused the start because too many runs are going (the free plan allows 5). */
export const isBusy = (e: unknown) => (e as { type?: string }).type === "concurrent-runs-limit-exceeded"
