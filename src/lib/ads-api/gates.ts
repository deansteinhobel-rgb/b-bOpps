/**
 * The switches for writes through the ad platforms' own APIs (Dean, 2026-10-21). All default to
 * the safe value. Like Notion and Windsor, only Dean (or Claude in Dean's own sessions) flips them:
 *
 *   ADS_API_WRITES_ENABLED=true   and   ADS_API_DRY_RUN=false   → writes may be sent
 *   ADS_API_PLATFORMS=linkedin,reddit                           → only these platforms (empty = none)
 *   ADS_API_LIVE_CLIENTS=dnsfilter                              → only these clients (empty = every client)
 *
 * Anything else is a dry run: every call is logged with the exact request and nothing is sent.
 * A plain module (no server-only import) so the tests can use it.
 */
export const ADS_API_PLATFORMS = ["linkedin", "reddit"] as const
export type AdsApiPlatform = (typeof ADS_API_PLATFORMS)[number]

export type AdsApiEnv = { writesEnabled: boolean; dryRun: boolean; platforms: string[]; liveClients: string[] | null }

const list = (raw: string | undefined) =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

export function adsApiEnv(env: Record<string, string | undefined> = process.env): AdsApiEnv {
  const clients = list(env.ADS_API_LIVE_CLIENTS)
  return {
    writesEnabled: env.ADS_API_WRITES_ENABLED === "true",
    dryRun: env.ADS_API_DRY_RUN !== "false",
    platforms: list(env.ADS_API_PLATFORMS),
    liveClients: clients.length ? clients : null,
  }
}

/**
 * Edits to campaigns that are already in the platform (pause, daily budget, end date, name) need
 * one more switch on top: ADS_API_EDITS_ENABLED=true (Dean, 2026-10-21). Off by default.
 */
export function editDryRunReason(env: AdsApiEnv & { editsEnabled?: boolean }, platform: AdsApiPlatform, clientSlug: string): string | null {
  if (!env.editsEnabled) return "ADS_API_EDITS_ENABLED: edits to campaigns are off, nothing was sent"
  return dryRunReason(env, platform, clientSlug)
}

export const adsApiEditsEnabled = (env: Record<string, string | undefined> = process.env) => env.ADS_API_EDITS_ENABLED === "true"

/** Why a write would be a dry run, or null when it would really be sent. */
export function dryRunReason(env: AdsApiEnv, platform: AdsApiPlatform, clientSlug: string): string | null {
  if (!env.writesEnabled || env.dryRun) return "ADS_API_WRITES_ENABLED/ADS_API_DRY_RUN: nothing was sent"
  if (!env.platforms.includes(platform)) return `ADS_API_PLATFORMS: live writes are off for ${platform}, nothing was sent`
  if (env.liveClients && !env.liveClients.includes(clientSlug.toLowerCase())) return "ADS_API_LIVE_CLIENTS: live writes are off for this client, nothing was sent"
  return null
}
