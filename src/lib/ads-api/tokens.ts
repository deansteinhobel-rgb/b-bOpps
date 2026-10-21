import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Access tokens for the ad platforms' own APIs. The refresh token lives in Supabase Vault
 * (`ads_api_token` / `set_ads_api_token`, service role only), with the .env value as the first
 * seed; `pnpm ads:connect <platform>` stores a new one. When a platform hands back a new refresh
 * token (Microsoft does every time), it replaces the old one in Vault. Access tokens are kept in
 * memory until a minute before they expire. Never log a token.
 */
export type TokenPlatform = "linkedin" | "reddit" | "microsoft_ads"

export const USER_AGENT = "lumaux/1.0 by Bordeaux & Burgundy"

type Grant = { url: string; body: Record<string, string>; headers?: Record<string, string> }

function grantFor(platform: TokenPlatform, refreshToken: string): Grant {
  if (platform === "linkedin") {
    return {
      url: "https://www.linkedin.com/oauth/v2/accessToken",
      body: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: need("LINKEDIN_ADS_CLIENT_ID"), client_secret: need("LINKEDIN_ADS_CLIENT_SECRET") },
    }
  }
  if (platform === "reddit") {
    return {
      url: "https://www.reddit.com/api/v1/access_token",
      body: { grant_type: "refresh_token", refresh_token: refreshToken },
      headers: { Authorization: `Basic ${Buffer.from(`${need("REDDIT_ADS_CLIENT_ID")}:${need("REDDIT_ADS_CLIENT_SECRET")}`).toString("base64")}`, "User-Agent": USER_AGENT },
    }
  }
  return {
    url: `https://login.microsoftonline.com/${process.env.MICROSOFT_ADS_TENANT_ID || "common"}/oauth2/v2.0/token`,
    body: {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: need("MICROSOFT_ADS_CLIENT_ID"),
      client_secret: need("MICROSOFT_ADS_CLIENT_SECRET"),
      scope: "https://ads.microsoft.com/msads.manage offline_access",
    },
  }
}

const ENV_SEED: Record<TokenPlatform, string> = {
  linkedin: "LINKEDIN_ADS_REFRESH_TOKEN",
  reddit: "REDDIT_ADS_REFRESH_TOKEN",
  microsoft_ads: "MICROSOFT_ADS_REFRESH_TOKEN",
}

function need(key: string) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} isn't set`)
  return value
}

const cache = new Map<TokenPlatform, { token: string; expiresAt: number }>()

/** A refresh token: Vault first, then the .env seed. */
async function refreshTokenFor(platform: TokenPlatform) {
  const { data } = await createAdminClient().rpc("ads_api_token", { p_platform: platform })
  const token = (typeof data === "string" && data) || process.env[ENV_SEED[platform]] || ""
  if (!token) throw new Error(`${platform} isn't connected yet. Run pnpm ads:connect ${platform === "microsoft_ads" ? "microsoft" : platform}.`)
  return token
}

/** Stores a refresh token in Vault and notes when the connection was made. Used by ads:connect too. */
export async function saveRefreshToken(platform: TokenPlatform, refreshToken: string, expiresInSeconds?: number) {
  const db = createAdminClient()
  const { error } = await db.rpc("set_ads_api_token", { p_platform: platform, p_token: refreshToken })
  if (error) throw new Error(`Couldn't store the ${platform} token: ${error.message}`)
  const now = new Date()
  await db.from("ads_api_connections").upsert({
    platform,
    connected_at: now.toISOString(),
    refresh_expires_at: expiresInSeconds ? new Date(now.getTime() + expiresInSeconds * 1000).toISOString() : null,
    updated_at: now.toISOString(),
  })
}

export async function accessToken(platform: TokenPlatform): Promise<string> {
  const hit = cache.get(platform)
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token

  const refresh = await refreshTokenFor(platform)
  const grant = grantFor(platform, refresh)
  const response = await fetch(grant.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...grant.headers },
    body: new URLSearchParams(grant.body),
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number; error?: string; error_description?: string }
  if (!response.ok || !json.access_token) throw new Error(`${platform} token refresh failed (${response.status}): ${json.error_description ?? json.error ?? "no detail"}`)

  // Microsoft (and sometimes others) hand back a new refresh token: keep it, or the old one runs out.
  if (json.refresh_token && json.refresh_token !== refresh) await saveRefreshToken(platform, json.refresh_token, json.refresh_token_expires_in)
  await createAdminClient().from("ads_api_connections").update({ last_refreshed_at: new Date().toISOString() }).eq("platform", platform)

  cache.set(platform, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 })
  return json.access_token
}
