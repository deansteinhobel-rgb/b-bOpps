import { PlatformRefused, type BuildOperation, type Sender } from "./build"

/**
 * Microsoft Advertising Campaign Management API (REST, v13) sender (Dean, 2026-10-21). Five create
 * calls and nothing else; campaigns, ad groups and ads are forced to Status "Paused".
 *
 * UNVERIFIED: no live Microsoft build has run, and no client has a Microsoft account mapped yet.
 * Paths, headers and the reply's *Ids / PartialErrors come from Microsoft's REST reference as of
 * 2026-10. Before adding microsoft_ads to ADS_API_PLATFORMS, check a dry run's payloads against the
 * docs and one read call with the real token. The customer id is MICROSOFT_ADS_CUSTOMER_ID.
 * A plain module: the server passes in the token and settings.
 */
const API = "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13"

const CREATES: Partial<Record<BuildOperation, { path: string; ids: string }>> = {
  create_campaign: { path: "/Campaigns", ids: "CampaignIds" },
  set_locations: { path: "/CampaignCriterions", ids: "CampaignCriterionIds" },
  create_ad_group: { path: "/AdGroups", ids: "AdGroupIds" },
  add_keywords: { path: "/Keywords", ids: "KeywordIds" },
  create_ad: { path: "/Ads", ids: "AdIds" },
}

export type MicrosoftDeps = { token: () => Promise<string>; developerToken: string; customerId: string; fetch?: typeof fetch }

/** Every campaign, ad group and ad in the body goes in paused, whatever it says. */
export function forcePaused(operation: BuildOperation, body: Record<string, unknown>): Record<string, unknown> {
  const pause = (key: string) => (Array.isArray(body[key]) ? { [key]: (body[key] as Record<string, unknown>[]).map((x) => ({ ...x, Status: "Paused" })) } : {})
  if (operation === "create_campaign") return { ...body, ...pause("Campaigns") }
  if (operation === "create_ad_group") return { ...body, ...pause("AdGroups") }
  if (operation === "create_ad") return { ...body, ...pause("Ads") }
  return body
}

export function microsoftSender(deps: MicrosoftDeps): Sender {
  const f = deps.fetch ?? fetch
  return {
    async send(operation, accountId, payload) {
      const call = CREATES[operation]
      if (!call) throw new PlatformRefused(`Microsoft Ads has no ${operation} here.`)
      if (!/^\d+$/.test(accountId)) throw new PlatformRefused("That isn't a Microsoft Ads account.")
      if (!/^\d+$/.test(deps.customerId)) throw new PlatformRefused("MICROSOFT_ADS_CUSTOMER_ID isn't set.")
      const body = forcePaused(operation, operation === "create_campaign" ? { AccountId: Number(accountId), ...payload } : payload)
      const response = await f(`${API}${call.path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await deps.token()}`,
          DeveloperToken: deps.developerToken,
          CustomerId: deps.customerId,
          CustomerAccountId: accountId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null
      const errors = (json?.PartialErrors ?? json?.Errors ?? json?.OperationErrors) as { Message?: string; ErrorCode?: string }[] | null | undefined
      if (!response.ok) {
        const message = `Microsoft Ads ${operation}: ${response.status} ${errors?.[0]?.Message ?? (json?.Message as string | undefined) ?? response.statusText}`
        if (response.status >= 400 && response.status < 500) throw new PlatformRefused(message, json)
        throw new Error(message)
      }
      // A 200 with PartialErrors means some or all items were refused: treat it as refused (nothing usable).
      if (Array.isArray(errors) && errors.some(Boolean)) throw new PlatformRefused(`Microsoft Ads ${operation}: ${errors.find(Boolean)?.Message ?? "refused"}`, json)
      const ids = (json?.[call.ids] as (number | string | null)[] | undefined) ?? []
      const first = ids.find((x) => x !== null && x !== undefined)
      if (operation === "set_locations" || operation === "add_keywords") return { id: "done", raw: json }
      if (first === undefined || first === null) throw new Error(`Microsoft Ads ${operation}: created, but no id came back`)
      return { id: String(first), raw: { status: response.status, ids } }
    },
  }
}
