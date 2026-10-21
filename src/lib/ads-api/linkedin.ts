import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { PlatformRefused, type BuildOperation, type Sender } from "./build"
import type { EditSender } from "./edit"
import { accessToken } from "./tokens"

/**
 * LinkedIn Marketing API sender (Dean, 2026-10-21). It knows exactly five create calls, plus one
 * partial update for campaign edits (linkedInEditSender): no enabling, no removing, no deletes. Statuses are forced here whatever the payload says:
 * campaign groups DRAFT (LinkedIn doesn't allow PAUSED on create), campaigns and ads PAUSED, posts
 * dark (feedDistribution NONE: shown only as ads, never on the company page).
 */
export const LINKEDIN_VERSION = "202610"
const API = "https://api.linkedin.com/rest"

type Fetcher = typeof fetch
export type LinkedInDeps = { token: () => Promise<string>; readImage: (path: string) => Promise<{ bytes: Uint8Array; contentType: string }>; fetch?: Fetcher }

const CREATES: Partial<Record<BuildOperation, { path: (account: string) => string; force: Record<string, unknown> }>> = {
  create_campaign_group: { path: (a) => `/adAccounts/${a}/adCampaignGroups`, force: { status: "DRAFT" } },
  create_campaign: { path: (a) => `/adAccounts/${a}/adCampaigns`, force: { status: "PAUSED" } },
  create_post: { path: () => "/posts", force: { lifecycleState: "PUBLISHED", distribution: { feedDistribution: "NONE", targetEntities: [], thirdPartyDistributionChannels: [] } } },
  create_ad: { path: (a) => `/adAccounts/${a}/creatives`, force: { intendedStatus: "PAUSED" } },
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, "LinkedIn-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" }
}

/** A 4xx means LinkedIn refused and nothing was made; anything else is an unknown outcome. */
async function fail(response: Response, what: string): Promise<never> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null
  const message = `LinkedIn ${what}: ${response.status} ${body?.message ?? response.statusText}`
  if (response.status >= 400 && response.status < 500) throw new PlatformRefused(message, body)
  throw new Error(message)
}

export function linkedInSender(deps: LinkedInDeps = { token: () => accessToken("linkedin"), readImage: bucketImage }): Sender {
  const f = deps.fetch ?? fetch
  return {
    async send(operation, accountId, payload) {
      if (!/^\d+$/.test(accountId)) throw new PlatformRefused("That isn't a LinkedIn ad account.")
      const token = await deps.token()
      if (operation === "upload_image") return uploadImage(f, token, payload, deps.readImage)
      const call = CREATES[operation]
      if (!call) throw new PlatformRefused(`LinkedIn has no ${operation} here.`)
      const response = await f(`${API}${call.path(accountId)}`, { method: "POST", headers: headers(token), body: JSON.stringify({ ...payload, ...call.force }), signal: AbortSignal.timeout(30_000) })
      if (response.status !== 201) return fail(response, operation)
      const id = response.headers.get("x-restli-id")
      if (!id) throw new Error(`LinkedIn ${operation}: created, but no id came back`)
      return { id, raw: { status: 201, id } }
    },
  }
}

/** initializeUpload → PUT the bytes to LinkedIn's upload URL → wait until the image is AVAILABLE. */
async function uploadImage(f: Fetcher, token: string, payload: Record<string, unknown>, readImage: LinkedInDeps["readImage"]) {
  const owner = String(payload.owner ?? "")
  if (!/^urn:li:organization:\d+$/.test(owner)) throw new PlatformRefused("The image needs the company page it belongs to.")
  const image = await readImage(String(payload.imagePath ?? ""))
  if (!/^image\/(jpeg|png|gif)$/.test(image.contentType)) throw new PlatformRefused("LinkedIn takes JPG, PNG or GIF images.")

  const init = await f(`${API}/images?action=initializeUpload`, { method: "POST", headers: headers(token), body: JSON.stringify({ initializeUploadRequest: { owner } }), signal: AbortSignal.timeout(30_000) })
  if (!init.ok) return fail(init, "image upload")
  const { value } = (await init.json()) as { value?: { uploadUrl?: string; image?: string } }
  if (!value?.uploadUrl || !value.image) throw new Error("LinkedIn image upload: no upload URL came back")
  // Only ever send the bytes to LinkedIn itself.
  const target = new URL(value.uploadUrl)
  if (target.protocol !== "https:" || !(target.hostname === "linkedin.com" || target.hostname.endsWith(".linkedin.com"))) throw new Error("LinkedIn image upload: unexpected upload host")

  const put = await f(target, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": image.contentType }, body: image.bytes as BodyInit, signal: AbortSignal.timeout(60_000) })
  if (!put.ok) return fail(put, "image bytes")

  for (let i = 0; i < 10; i++) {
    const check = await f(`${API}/images/${encodeURIComponent(value.image)}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) })
    const status = check.ok ? ((await check.json()) as { status?: string }).status : null
    if (status === "AVAILABLE") return { id: value.image, raw: { image: value.image, status } }
    if (status === "PROCESSING_FAILED") throw new PlatformRefused("LinkedIn couldn't process the image.")
    await new Promise((r) => setTimeout(r, 2000))
  }
  // Uploaded but not ready yet: the post step would fail, so stop here; the image itself is harmless.
  throw new Error("LinkedIn image upload: still processing after 20 seconds")
}

/** Images for builds: our copy in the private campaign-assets bucket (the service checks the path is the client's). */
async function bucketImage(path: string) {
  if (!/^[0-9a-f-]{36}\/[\w.-]+\.(png|jpe?g|gif)$/i.test(path)) throw new PlatformRefused("That isn't a campaign image.")
  const { data, error } = await createAdminClient().storage.from("campaign-assets").download(path)
  if (error || !data) throw new PlatformRefused("Couldn't read the image from storage.")
  return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "image/png" }
}

/**
 * Edits to a campaign that exists (Dean, 2026-10-21; edit.ts builds the patch): one partial update
 * on the campaign, nothing else. The patch can't set any status but PAUSED, and targeting only
 * whole, on its own, with an include side (exclusions from Recommendations).
 */
export function linkedInEditSender(deps: { token: () => Promise<string>; fetch?: Fetcher } = { token: () => accessToken("linkedin") }): EditSender {
  const f = deps.fetch ?? fetch
  return {
    async patch(accountId, campaignId, body) {
      if (!/^\d+$/.test(accountId) || !/^\d+$/.test(campaignId)) throw new Error("That isn't a LinkedIn campaign.")
      const set = (body as { patch?: { $set?: Record<string, unknown> } }).patch?.$set ?? {}
      if (!Object.keys(set).length) throw new Error("Nothing to send.")
      if ("status" in set && set.status !== "PAUSED") throw new Error("Lumaux only ever pauses campaigns.")
      const allowed = new Set(["status", "dailyBudget", "runSchedule", "name", "targetingCriteria"])
      if (Object.keys(set).some((k) => !allowed.has(k))) throw new Error("That change isn't one Lumaux makes.")
      // Targeting goes alone and always whole (exclusions.ts keeps its include side as it was).
      if ("targetingCriteria" in set) {
        const t = set.targetingCriteria as { include?: unknown } | null
        if (Object.keys(set).length > 1 || !t || typeof t !== "object" || !t.include) throw new Error("That targeting change isn't one Lumaux makes.")
      }
      const response = await f(`${API}/adAccounts/${accountId}/adCampaigns/${campaignId}`, {
        method: "POST",
        headers: { ...headers(await deps.token()), "X-RestLi-Method": "PARTIAL_UPDATE" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status !== 204 && !response.ok) return fail(response, "campaign update")
      return { status: response.status }
    },
  }
}

/** Read only: how many members a targeting reaches. LinkedIn reports 0 under its minimum of 300. */
export async function linkedInAudienceCount(targetingCriteria: unknown, deps: { token: () => Promise<string>; fetch?: Fetcher } = { token: () => accessToken("linkedin") }) {
  const token = await deps.token()
  const query = `q=targetingCriteriaV2&targetingCriteria=${restli(targetingCriteria)}`
  const response = await (deps.fetch ?? fetch)(`${API}/audienceCounts?${query}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`LinkedIn audience count: ${response.status}`)
  const json = (await response.json()) as { elements?: { total?: number }[] }
  return json.elements?.[0]?.total ?? 0
}

/** Rest.li 2.0 query encoding: objects as (k:v), arrays as List(…), URNs URL-encoded. */
export function restli(value: unknown): string {
  if (Array.isArray(value)) return `List(${value.map(restli).join(",")})`
  if (value && typeof value === "object") return `(${Object.entries(value).map(([k, v]) => `${encodeURIComponent(k)}:${restli(v)}`).join(",")})`
  return encodeURIComponent(String(value))
}
