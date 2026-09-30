import { PLATFORM_LABEL, type Platform } from "./types"

/** Plain names for the Windsor fields that count as a conversion or a lead (per account). */
const FIELD_LABEL: Record<string, string> = {
  externalwebsiteconversions: "website conversions",
  oneclickleads: "lead gen form submissions",
  conversions: "primary conversion actions",
  all_conversions: "all conversion actions",
  actions_lead: "leads",
  conversions_offsite_conversion_fb_pixel_custom_marketingqualifiedlead: "pixel event: Marketing Qualified Lead",
}
const label = (f: string) => FIELD_LABEL[f] ?? f

export type ResultFields = { platform: Platform; conversions: string[]; leads: string[] }

/** One line per platform: what counts as a conversion and what counts as a lead. */
export function resultFieldLines(accounts: ResultFields[]): string[] {
  const byPlatform = new Map<Platform, { conversions: Set<string>; leads: Set<string> }>()
  for (const a of accounts) {
    const p = byPlatform.get(a.platform) ?? { conversions: new Set(), leads: new Set() }
    a.conversions.forEach((f) => p.conversions.add(label(f)))
    a.leads.forEach((f) => p.leads.add(label(f)))
    byPlatform.set(a.platform, p)
  }
  return [...byPlatform].map(([platform, p]) => {
    const parts = [p.conversions.size ? `conversions = ${[...p.conversions].join(" + ")}` : "no conversions counted", p.leads.size ? `leads = ${[...p.leads].join(" + ")}` : null]
    return `${PLATFORM_LABEL[platform]}: ${parts.filter(Boolean).join("; ")}`
  })
}
