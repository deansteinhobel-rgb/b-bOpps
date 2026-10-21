import "server-only"
import { PlatformRefused, type BuildOperation, type Sender } from "./build"
import { accessToken, USER_AGENT } from "./tokens"

/**
 * Reddit Ads API v3 sender (Dean, 2026-10-21). Three create calls and nothing else; every one is
 * forced to configured_status PAUSED. Ads use posts that already exist on the client's profile.
 *
 * UNVERIFIED: Reddit's v3 docs couldn't be read on 2026-10-21. Paths, the {data: …} wrapper and the
 * reply's data.id come from an unofficial client. Before adding reddit to ADS_API_PLATFORMS, check a
 * dry run's payloads against Reddit's docs and one read call with the real token.
 */
const API = "https://ads-api.reddit.com/api/v3"

const CREATES: Partial<Record<BuildOperation, (account: string) => string>> = {
  create_campaign: (a) => `/ad_accounts/${a}/campaigns`,
  create_ad_group: (a) => `/ad_accounts/${a}/ad_groups`,
  create_ad: (a) => `/ad_accounts/${a}/ads`,
}

export type RedditDeps = { token: () => Promise<string>; fetch?: typeof fetch }

export function redditSender(deps: RedditDeps = { token: () => accessToken("reddit") }): Sender {
  const f = deps.fetch ?? fetch
  return {
    async send(operation, accountId, payload) {
      const path = CREATES[operation]
      if (!path) throw new PlatformRefused(`Reddit has no ${operation} here.`)
      if (!/^[\w-]+$/.test(accountId)) throw new PlatformRefused("That isn't a Reddit ad account.")
      const token = await deps.token()
      const response = await f(`${API}${path(accountId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT, "Content-Type": "application/json" },
        body: JSON.stringify({ data: { ...payload, configured_status: "PAUSED" } }),
        signal: AbortSignal.timeout(30_000),
      })
      const json = (await response.json().catch(() => null)) as { data?: { id?: string }; message?: string; error?: unknown } | null
      if (!response.ok) {
        const message = `Reddit ${operation}: ${response.status} ${json?.message ?? response.statusText}`
        if (response.status >= 400 && response.status < 500) throw new PlatformRefused(message, json)
        throw new Error(message)
      }
      const id = json?.data?.id
      if (!id) throw new Error(`Reddit ${operation}: created, but no id came back`)
      return { id: String(id), raw: { status: response.status, id } }
    },
  }
}
