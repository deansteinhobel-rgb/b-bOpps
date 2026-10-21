/**
 * Connects Lumaux to an ad platform's API once: opens the platform's consent page, catches the
 * redirect on http://localhost:8765/callback, swaps the code for a refresh token and saves it in
 * .env.local. Then makes one read-only call to prove the token works. Writes nothing to any ad
 * account.
 *
 *   pnpm ads:connect reddit | linkedin | microsoft
 *
 * Sign in as the person whose access the app should use (they need access to every client's ad
 * account). Each app must list http://localhost:8765/callback as a redirect URI first. Never print
 * the tokens: they're as good as a password.
 */
import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"

const REDIRECT = "http://localhost:8765/callback"
const ENV_FILE = ".env.local"
const LINKEDIN_VERSION = "202609"

type Platform = {
  authorize: (state: string) => string
  exchange: (code: string) => Promise<Record<string, unknown>>
  refreshKey: string
  check: (accessToken: string) => Promise<string>
}

const env = (key: string) => {
  const value = process.env[key]
  if (!value) throw new Error(`${key} is missing from ${ENV_FILE}`)
  return value
}

async function tokenRequest(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body),
  })
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new Error(`Token exchange failed (${response.status}): ${String(json.error_description ?? json.error ?? "no detail")}`)
  return json
}

const PLATFORMS: Record<string, Platform> = {
  reddit: {
    authorize: (state) =>
      `https://www.reddit.com/api/v1/authorize?${new URLSearchParams({
        client_id: env("REDDIT_ADS_CLIENT_ID"),
        response_type: "code",
        state,
        redirect_uri: REDIRECT,
        duration: "permanent",
        scope: "adsread adsedit adsconversions history",
      })}`,
    exchange: (code) =>
      tokenRequest(
        "https://www.reddit.com/api/v1/access_token",
        { grant_type: "authorization_code", code, redirect_uri: REDIRECT },
        {
          Authorization: `Basic ${Buffer.from(`${env("REDDIT_ADS_CLIENT_ID")}:${env("REDDIT_ADS_CLIENT_SECRET")}`).toString("base64")}`,
          "User-Agent": "lumaux/1.0 by Bordeaux & Burgundy",
        },
      ),
    refreshKey: "REDDIT_ADS_REFRESH_TOKEN",
    check: async (token) => {
      const response = await fetch("https://ads-api.reddit.com/api/v3/me/businesses", {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "lumaux/1.0 by Bordeaux & Burgundy" },
      })
      const json = (await response.json().catch(() => ({}))) as { data?: { id: string; name: string }[] }
      if (!response.ok) return `Reddit Ads API answered ${response.status}`
      return `Reddit businesses: ${(json.data ?? []).map((b) => `${b.name} (${b.id})`).join(", ") || "none"}`
    },
  },
  linkedin: {
    authorize: (state) =>
      `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({
        response_type: "code",
        client_id: env("LINKEDIN_ADS_CLIENT_ID"),
        redirect_uri: REDIRECT,
        state,
        scope: "r_ads rw_ads r_ads_reporting r_organization_social w_organization_social",
      })}`,
    exchange: (code) =>
      tokenRequest("https://www.linkedin.com/oauth/v2/accessToken", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: env("LINKEDIN_ADS_CLIENT_ID"),
        client_secret: env("LINKEDIN_ADS_CLIENT_SECRET"),
      }),
    refreshKey: "LINKEDIN_ADS_REFRESH_TOKEN",
    check: async (token) => {
      const response = await fetch("https://api.linkedin.com/rest/adAccounts?q=search&count=100", {
        headers: { Authorization: `Bearer ${token}`, "LinkedIn-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0" },
      })
      const json = (await response.json().catch(() => ({}))) as { elements?: { id: number; name: string }[]; message?: string }
      if (!response.ok) return `LinkedIn answered ${response.status}: ${json.message ?? "no detail"}`
      return `LinkedIn ad accounts: ${(json.elements ?? []).map((a) => `${a.name} (${a.id})`).join(", ") || "none"}`
    },
  },
  microsoft: {
    authorize: (state) =>
      `https://login.microsoftonline.com/${env("MICROSOFT_ADS_TENANT_ID")}/oauth2/v2.0/authorize?${new URLSearchParams({
        client_id: env("MICROSOFT_ADS_CLIENT_ID"),
        response_type: "code",
        redirect_uri: REDIRECT,
        response_mode: "query",
        scope: "https://ads.microsoft.com/msads.manage offline_access",
        state,
        prompt: "select_account",
      })}`,
    exchange: (code) =>
      tokenRequest(`https://login.microsoftonline.com/${env("MICROSOFT_ADS_TENANT_ID")}/oauth2/v2.0/token`, {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: env("MICROSOFT_ADS_CLIENT_ID"),
        client_secret: env("MICROSOFT_ADS_CLIENT_SECRET"),
        scope: "https://ads.microsoft.com/msads.manage offline_access",
      }),
    refreshKey: "MICROSOFT_ADS_REFRESH_TOKEN",
    // The account list needs the SOAP Customer Management service; a token is enough proof for now.
    check: async () => `Microsoft token received (developer token ${process.env.MICROSOFT_ADS_DEVELOPER_TOKEN ? "set" : "missing"})`,
  },
}

/** Sets KEY=value in .env.local, replacing the existing line or adding one. */
function saveEnv(key: string, value: string) {
  const lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/)
  const at = lines.findIndex((line) => line.startsWith(`${key}=`))
  if (at >= 0) lines[at] = `${key}=${value}`
  else lines.push(`${key}=${value}`)
  writeFileSync(ENV_FILE, lines.join("\n"))
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]]
  execFile(cmd as string, args as string[], (e) => {
    if (e) console.log(`Couldn't open the browser. Open this link yourself:\n${url}`)
  })
}

const name = (process.argv[2] ?? "").toLowerCase()
const platform = PLATFORMS[name]
if (!platform) {
  console.error("Usage: pnpm ads:connect reddit | linkedin | microsoft")
  process.exit(1)
}

const state = randomBytes(16).toString("hex")
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", REDIRECT)
  if (url.pathname !== "/callback") return void response.writeHead(404).end()
  const finish = (message: string, ok: boolean) => {
    response.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" }).end(`${message}\nYou can close this tab.`)
    console[ok ? "log" : "error"](message)
    server.close()
    if (!ok) process.exitCode = 1
  }
  if (url.searchParams.get("state") !== state) return finish("State didn't match. Run the script again.", false)
  const code = url.searchParams.get("code")
  if (!code) return finish(`No code: ${url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "refused"}`, false)
  try {
    const tokens = await platform.exchange(code)
    const refresh = typeof tokens.refresh_token === "string" ? tokens.refresh_token : ""
    if (!refresh) {
      return finish(
        name === "linkedin"
          ? "LinkedIn gave no refresh token: the app isn't enabled for programmatic refresh tokens yet (Advertising API Standard tier). Nothing saved."
          : "No refresh token came back. Nothing saved.",
        false,
      )
    }
    saveEnv(platform.refreshKey, refresh)
    const check = await platform.check(String(tokens.access_token ?? ""))
    finish(`Saved ${platform.refreshKey} in ${ENV_FILE}. ${check}`, true)
  } catch (e) {
    finish(e instanceof Error ? e.message : String(e), false)
  }
})

server.listen(8765, "127.0.0.1", () => {
  console.log(`Opening ${name}'s consent page. Waiting on ${REDIRECT} …`)
  openBrowser(platform.authorize(state))
})
