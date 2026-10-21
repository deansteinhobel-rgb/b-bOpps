import "server-only"
import { windsorRows } from "@/lib/windsor/rest"
import { conversionKey, jsonObject, pagesOf, promotedOf, type MetaConversion } from "./meta-ids"

export type MetaAdSetRead = { id: string; name: string; campaign: string; spend: number; targeting: Record<string, unknown> | null }
export type MetaAccountRead = { pages: string[]; conversions: MetaConversion[]; adSets: MetaAdSetRead[] }

/**
 * What a Meta account already uses, read from Windsor (read only): the pages its ads run as, the
 * conversions its ad sets optimize for, and its ad sets with their whole targeting. Two requests,
 * neither with an actions field (see meta-ids.ts). Shared by the planner and the builder.
 */
export async function readMetaAccount(connector: string, accountId: string, from: string, to: string): Promise<MetaAccountRead> {
  const [adSetRows, adRows] = await Promise.all([
    windsorRows(connector, accountId, ["adset_id", "adset_name", "campaign", "adset_promoted_object", "adset_targeting", "spend"], from, to, { timeoutMs: 90_000, label: "meta ad sets" }) as Promise<Record<string, unknown>[]>,
    windsorRows(connector, accountId, ["actor_id", "spend"], from, to, { timeoutMs: 60_000, label: "meta pages" }) as Promise<Record<string, unknown>[]>,
  ])
  const pages = new Set(pagesOf(adRows))
  const conversions = new Map<string, MetaConversion>()
  const adSets = new Map<string, MetaAdSetRead>()
  for (const r of adSetRows) {
    const { pageId, conversion } = promotedOf(r.adset_promoted_object)
    if (pageId) pages.add(pageId)
    if (conversion) conversions.set(conversionKey(conversion), conversion)
    const id = String(r.adset_id ?? "")
    if (!/^\d+$/.test(id)) continue
    const a = adSets.get(id) ?? { id, name: String(r.adset_name || id), campaign: String(r.campaign ?? ""), spend: 0, targeting: null }
    a.spend += Number(r.spend) || 0
    a.targeting = jsonObject(r.adset_targeting) ?? a.targeting
    adSets.set(id, a)
  }
  return { pages: [...pages], conversions: [...conversions.values()], adSets: [...adSets.values()].sort((a, b) => b.spend - a.spend) }
}
