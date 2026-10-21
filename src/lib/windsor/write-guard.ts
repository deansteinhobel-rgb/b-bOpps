/**
 * The Windsor write actions Lumaux may run, per connector (Dean, 2026-10-21), and the checks every
 * call passes whoever makes it: the action must be on the list, every create goes in paused, and
 * Meta updates may only touch a few fields. Windsor also offers enable, remove and delete actions;
 * they are not on the list and never will be. A plain module so the tests can use it.
 */
export const ALLOWED = {
  google_ads: [
    // Negatives, ads and pauses from Recommendations and sprint tests.
    "push_negative_keywords",
    "create_responsive_search_ad",
    "pause_ad",
    // Campaign builds.
    "create_campaign",
    "create_ad_group",
    "push_keywords",
    "set_campaign_geo_targeting",
    "set_campaign_language_targeting",
    "create_ad_asset",
    // Edits to live campaigns.
    "pause_campaign",
    "set_campaign_budget",
    "rename_campaign",
  ],
  facebook: ["create_campaign", "create_adset", "create_ad", "pause_campaign", "pause_adset", "set_campaign_budget", "set_adset_budget", "update_campaign", "update_adset"],
  bing: ["pause_campaign", "set_campaign_budget"],
} as const

export type WindsorConnector = keyof typeof ALLOWED
export type WindsorAction<C extends WindsorConnector = WindsorConnector> = (typeof ALLOWED)[C][number]

/** Creates go in paused, whatever the caller passes. */
const CREATES = new Set(["create_campaign", "create_ad_group", "create_adset", "create_ad", "create_responsive_search_ad"])

/** Meta updates: these fields only (status and budgets have their own actions; no enabling through the back door). */
const META_UPDATE_FIELDS: Record<string, string[]> = { update_campaign: ["campaign_id", "name"], update_adset: ["adset_id", "name", "end_time", "targeting"] }

/** The params Windsor gets. Throws when the action or its params aren't allowed. */
export function guardParams(connector: string, action: string, params: Record<string, unknown>): Record<string, unknown> {
  const list = (ALLOWED as Record<string, readonly string[]>)[connector]
  if (!list || !list.includes(action) || /^(enable|remove|delete)_/.test(action)) throw new Error(`Windsor action ${connector} ${action} isn't allowed`)
  if (connector === "facebook" && META_UPDATE_FIELDS[action]) {
    const extra = Object.keys(params).filter((k) => !META_UPDATE_FIELDS[action].includes(k))
    if (extra.length) throw new Error(`Lumaux doesn't change ${extra.join(", ")} on Meta`)
    if (action === "update_adset" && "targeting" in params) {
      const t = params.targeting as { geo_locations?: unknown } | null
      // A targeting update replaces the whole audience: it must be the whole targeting, read first.
      if (!t || typeof t !== "object" || !t.geo_locations) throw new Error("That targeting change isn't one Lumaux makes.")
    }
  }
  return CREATES.has(action) ? { ...params, status: "paused" } : params
}
