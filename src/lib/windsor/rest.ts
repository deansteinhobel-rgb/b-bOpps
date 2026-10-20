import "server-only"

export type WindsorRow = Record<string, unknown>

/**
 * One read from Windsor's REST API (`connectors.windsor.ai/<connector>`), filtered to one account by
 * Windsor (never pull all and filter). Every read in the app goes through here, so they share the
 * key check, the timeout and the error shape. Errors carry the HTTP status and Windsor's own message,
 * never the URL (it holds the key).
 */
export async function windsorRows(
  connector: string,
  account: string,
  fields: string[],
  from: string,
  to: string,
  opts: { timeoutMs?: number; label?: string } = {},
): Promise<WindsorRow[]> {
  const apiKey = process.env.WINDSOR_API_KEY
  if (!apiKey) throw new Error("WINDSOR_API_KEY is not set")
  const params = new URLSearchParams({ api_key: apiKey, date_from: from, date_to: to, select_accounts: account, fields: [...new Set(fields)].join(",") })
  const res = await fetch(`https://connectors.windsor.ai/${connector}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) })
  const body = (await res.json().catch(() => null)) as { data?: WindsorRow[]; error?: unknown } | null
  if (!res.ok || !Array.isArray(body?.data)) {
    throw new Error(`Windsor ${opts.label ?? connector}: HTTP ${res.status} ${String(body?.error ?? "").slice(0, 200)}`.trim())
  }
  return body.data
}
