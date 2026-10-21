import "server-only"
import { LINKEDIN_VERSION, restli } from "./linkedin"
import { accessToken } from "./tokens"

/**
 * Read-only LinkedIn Marketing API calls the campaign builder needs (Dean, 2026-10-21): looking up
 * targeting ids by name, the account's matched audiences (company and contact lists, retargeting),
 * a campaign as LinkedIn has it now (for edits: the value before) and the company page an account
 * advertises as. Performance numbers still come from Windsor. Response shapes are from LinkedIn's
 * docs; the matched audience listing is unverified until the first connected read.
 */
const API = "https://api.linkedin.com/rest"
type Fetcher = typeof fetch
export type ReadDeps = { token?: () => Promise<string>; fetch?: Fetcher }

async function get<T>(path: string, deps: ReadDeps = {}): Promise<T> {
  const token = await (deps.token ?? (() => accessToken("linkedin")))()
  const response = await (deps.fetch ?? fetch)(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "LinkedIn-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0" },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(`LinkedIn ${response.status}: ${body?.message ?? response.statusText}`)
  }
  return (await response.json()) as T
}

const accountUrn = (id: string) => {
  if (!/^\d+$/.test(id)) throw new Error("That isn't a LinkedIn ad account.")
  return `urn:li:sponsoredAccount:${id}`
}

/** Targeting values by name, e.g. facet "titles", query "IT director" → [{ name, urn }]. */
export async function targetingTypeahead(facet: string, query: string, deps?: ReadDeps) {
  if (!/^[A-Za-z]+$/.test(facet)) throw new Error("Unknown facet.")
  const q = `q=typeahead&facet=${encodeURIComponent(`urn:li:adTargetingFacet:${facet}`)}&query=${encodeURIComponent(query.slice(0, 100))}`
  const json = await get<{ elements?: { urn?: string; name?: string }[] }>(`/adTargetingEntities?${q}`, deps)
  return (json.elements ?? []).filter((e) => e.urn && e.name).slice(0, 15).map((e) => ({ name: e.name!, urn: e.urn! }))
}

export type MatchedAudience = { name: string; urn: string; type: string; status: string; size: number | null }

/** The account's matched audiences: uploaded company and contact lists, website and engagement retargeting. */
export async function matchedAudiences(accountId: string, deps?: ReadDeps): Promise<MatchedAudience[]> {
  const json = await get<{ elements?: { id?: number | string; name?: string; type?: string; status?: string; matchedMemberCount?: number; audienceSize?: number }[] }>(
    `/adSegments?q=accounts&accounts=${restli([accountUrn(accountId)])}&count=200`,
    deps,
  )
  return (json.elements ?? [])
    .filter((e) => e.id && e.name)
    .map((e) => ({ name: e.name!, urn: `urn:li:adSegment:${e.id}`, type: e.type ?? "", status: e.status ?? "", size: e.matchedMemberCount ?? e.audienceSize ?? null }))
}

export type LinkedInCampaign = {
  id: string
  name: string
  status: string
  objective: string | null
  dailyBudget: number | null
  currency: string | null
  start: string | null
  /** LinkedIn's own start time, kept as it is when the end date changes. */
  startMs: number | null
  end: string | null
  targetingCriteria: unknown
}

const day = (ms: number | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : null)

/** A campaign as LinkedIn has it now: the "before" for every edit. */
export async function readCampaign(accountId: string, campaignId: string, deps?: ReadDeps): Promise<LinkedInCampaign> {
  if (!/^\d+$/.test(campaignId)) throw new Error("That isn't a LinkedIn campaign.")
  accountUrn(accountId)
  const c = await get<{
    id?: number
    name?: string
    status?: string
    objectiveType?: string
    dailyBudget?: { amount?: string; currencyCode?: string }
    runSchedule?: { start?: number; end?: number }
    targetingCriteria?: unknown
  }>(`/adAccounts/${accountId}/adCampaigns/${campaignId}`, deps)
  return {
    id: String(c.id ?? campaignId),
    name: c.name ?? "",
    status: c.status ?? "",
    objective: c.objectiveType ?? null,
    dailyBudget: c.dailyBudget?.amount ? Number(c.dailyBudget.amount) : null,
    currency: c.dailyBudget?.currencyCode ?? null,
    start: day(c.runSchedule?.start),
    startMs: c.runSchedule?.start ?? null,
    end: day(c.runSchedule?.end),
    targetingCriteria: c.targetingCriteria ?? null,
  }
}

/** The company page an ad account belongs to (its posts' author), e.g. "1234567". */
export async function accountOrganization(accountId: string, deps?: ReadDeps): Promise<string | null> {
  const a = await get<{ reference?: string }>(`/adAccounts/${accountUrn(accountId).split(":").pop()}`, deps)
  const m = /^urn:li:organization:(\d+)$/.exec(a.reference ?? "")
  return m ? m[1] : null
}
