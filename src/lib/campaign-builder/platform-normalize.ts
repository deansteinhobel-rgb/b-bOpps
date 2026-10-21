import { MATCH_TYPES, META_CTAS, META_GOALS, META_OBJECTIVES } from "@/lib/ads-api/spec-platforms"
import type { MetaIds } from "./platform-history"
import { knownLocation, type OtherPlatform } from "./platform-plan"
import type { ProposalSource } from "./plan-schema"

/**
 * The planner's tool schema for each platform's draft, and the tidy-up between what Claude returns
 * and the plan schema (platform-plan.ts). The tidy-up is where ids are made safe: a Google or
 * Microsoft location id stays only when it's one we know for that name, Meta page, pixel and base ad
 * set ids only when the account already uses them, instant forms and audience ids never (the team
 * picks them), Reddit posts only as t3_ ids. Proposal images become our copies on Meta's image ads.
 * A plain module so the tests can use it.
 */

const S = (description?: string) => ({ type: "string", ...(description ? { description } : {}) })
const N = (description?: string) => ({ type: "number", ...(description ? { description } : {}) })
const nullable = (t: string, description?: string) => ({ type: [t, "null"], ...(description ? { description } : {}) })
const list = (items: object, description?: string, maxItems?: number) => ({ type: "array", items, ...(maxItems ? { maxItems } : {}), ...(description ? { description } : {}) })
const obj = (properties: Record<string, object>, required: string[], description?: string) => ({ type: "object", properties, required, ...(description ? { description } : {}) })

const notBuilt = list(obj({ name: S(), format: S("e.g. Performance Max, Display, video"), brief: S("What to build and every asset, under 80 words.") }, ["name", "format", "brief"]), "Campaigns or ads the app can't build here: briefed, then built in the platform.", 10)

const searchAdGroups = (headline: string) =>
  list(
    obj(
      {
        name: S(),
        cpcBid: nullable("number", "Max CPC, only for manual CPC."),
        keywords: list(obj({ text: S(), match: { type: "string", enum: [...MATCH_TYPES] } }, ["text", "match"]), "Exact or phrase first.", 60),
        ads: list(
          obj(
            {
              headlines: list(S("At most 30 characters, no '!'."), headline, 15),
              descriptions: list(S("At most 90 characters."), "2-4.", 4),
              finalUrl: S("On the client's website."),
              path1: S("At most 15 characters."),
              path2: S("At most 15 characters."),
              fromProposal: { type: "boolean" },
            },
            ["headlines", "descriptions", "finalUrl"],
          ),
          "1-2 responsive search ads.",
          3,
        ),
      },
      ["name", "keywords", "ads"],
    ),
    "One intent per ad group.",
    10,
  )

const location = obj({ id: nullable("integer", "Only when certain."), name: S() }, ["name"])

/** The draft part of the planner's tool schema, per platform (mirrors platform-plan.ts). */
export function platformDraftSchema(platform: OtherPlatform): object {
  switch (platform) {
    case "google_ads":
      return obj(
        {
          campaign: obj({ name: S("Follow the naming convention."), bidding: { type: "string", enum: ["manual_cpc", "maximize_conversions", "target_spend"] }, dailyBudget: N(), locations: list(location, "2840 United States, 2826 United Kingdom."), languages: list(S("Google code, e.g. en.")) }, ["name", "bidding", "dailyBudget", "locations", "languages"]),
          adGroups: searchAdGroups("8-15 per ad, all different."),
          sitelinks: list(obj({ text: S("At most 25 characters."), finalUrl: S(), description1: S("At most 35."), description2: S("At most 35.") }, ["text", "finalUrl"]), "Up to 4.", 8),
          callouts: list(S("At most 25 characters."), "Up to 4.", 10),
          notBuilt,
        },
        ["campaign", "adGroups"],
      )
    case "microsoft_ads":
      return obj(
        {
          campaign: obj({ name: S("Follow the naming convention."), bidding: { type: "string", enum: ["EnhancedCpc", "ManualCpc", "MaxClicks", "MaxConversions"] }, dailyBudget: N(), locations: list(location, "190 United States, 188 United Kingdom (unverified)."), languages: list(S("Language name, e.g. English.")) }, ["name", "bidding", "dailyBudget", "locations", "languages"]),
          adGroups: searchAdGroups("8-15 per ad, all different."),
          notBuilt,
        },
        ["campaign", "adGroups"],
      )
    case "meta":
      return obj(
        {
          pageId: nullable("string", "ONLY a page id listed in the context."),
          campaign: obj({ name: S("Follow the naming convention."), objective: { type: "string", enum: [...META_OBJECTIVES] }, specialAdCategories: list(S(), "Usually empty.") }, ["name", "objective"]),
          adSet: obj(
            {
              name: S(),
              dailyBudget: N(),
              startDate: S("YYYY-MM-DD, today or later"),
              endDate: nullable("string"),
              optimizationGoal: { type: "string", enum: [...META_GOALS] },
              pixel: { type: ["object", "null"], properties: { pixelId: S(), event: S() }, description: "ONLY a pixel and event listed in the context; website conversions only." },
              targeting: obj(
                {
                  baseAdSetId: nullable("string", "One of the listed ad set ids whose audience fits, or null."),
                  countries: list(S("ISO code, e.g. US")),
                  ageMin: { type: "integer" },
                  ageMax: { type: "integer" },
                  advantageAudience: { type: "boolean" },
                  audienceNetwork: { type: "boolean" },
                },
                ["countries"],
              ),
            },
            ["name", "dailyBudget", "startDate", "optimizationGoal", "targeting"],
          ),
          ads: list(
            obj(
              {
                name: S(),
                format: { type: "string", enum: ["single_image", "video", "carousel"] },
                message: S("Primary text, ideally under 125 characters."),
                headline: S("Under 40 characters."),
                description: S(),
                link: S("Landing page on the client's website."),
                callToAction: { type: "string", enum: [...META_CTAS] },
                creativeBrief: S("What the designer makes. Under 25 words. Empty when the proposal's image is used."),
                image: nullable("integer", "The [Image n] of the Notion proposal this ad uses, or null."),
                fromProposal: { type: "boolean" },
              },
              ["name", "format", "message", "headline", "link"],
            ),
            "3-4 ads testing one variable.",
            10,
          ),
          notBuilt,
        },
        ["campaign", "adSet", "ads"],
      )
    case "reddit":
      return obj(
        {
          campaign: obj({ name: S("Follow the naming convention."), objective: { type: "string", enum: ["CLICKS", "CONVERSIONS", "IMPRESSIONS", "LEAD_GENERATION", "BRAND_AWARENESS"] } }, ["name", "objective"]),
          adGroup: obj(
            {
              name: S(),
              bidStrategy: { type: "string", enum: ["MAXIMIZE_VOLUME", "MANUAL_BIDDING", "TARGET_CPX"] },
              bidType: { type: "string", enum: ["CPC", "CPM"] },
              bid: nullable("number"),
              dailyBudget: N(),
              startDate: S("YYYY-MM-DD, today or later"),
              endDate: nullable("string"),
              targeting: obj({ geolocations: list(S("Country code, e.g. US")), communities: list(S("Subreddit name, no r/")), interests: list(S()), keywords: list(S()) }, ["geolocations"]),
            },
            ["name", "dailyBudget", "startDate", "targeting"],
          ),
          ads: list(obj({ name: S(), postId: nullable("string", "Only a t3_ id the request names."), clickUrl: S("Landing page on the client's website."), headline: S("The post's title."), body: S("The post's text."), creativeBrief: S(), fromProposal: { type: "boolean" } }, ["name", "clickUrl", "headline"]), "3-4 ads.", 10),
          notBuilt,
        },
        ["campaign", "adGroup", "ads"],
      )
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown) => arr(v).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v))

function searchDraft(platform: "google_ads" | "microsoft_ads", d: Record<string, unknown>) {
  const c = isObj(d.campaign) ? d.campaign : {}
  return {
    ...d,
    campaign: {
      ...c,
      // Only ids we know for that name: a wrong location is worse than one the team fills in.
      locations: arr(c.locations).map((l) => {
        const name = isObj(l) ? text(l.name) : text(l)
        return { name, id: name ? knownLocation(platform, name) : null }
      }).filter((l) => l.name),
      languages: strs(c.languages),
    },
    adGroups: arr(d.adGroups).filter(isObj).map((g) => ({
      ...g,
      cpcBid: typeof g.cpcBid === "number" && g.cpcBid > 0 ? g.cpcBid : null,
      keywords: arr(g.keywords)
        .map((k) => (isObj(k) ? { text: text(k.text), match: (MATCH_TYPES as readonly string[]).includes(text(k.match).toUpperCase()) ? text(k.match).toUpperCase() : "PHRASE" } : { text: text(k), match: "PHRASE" }))
        .filter((k) => k.text),
      ads: arr(g.ads).filter(isObj).map((a) => ({ ...a, headlines: strs(a.headlines), descriptions: strs(a.descriptions), finalUrl: text(a.finalUrl), path1: text(a.path1), path2: text(a.path2), fromProposal: Boolean(a.fromProposal) })),
    })),
    ...(platform === "google_ads"
      ? { sitelinks: arr(d.sitelinks).filter(isObj).map((s) => ({ text: text(s.text), finalUrl: text(s.finalUrl), description1: text(s.description1), description2: text(s.description2) })).filter((s) => s.text), callouts: strs(d.callouts) }
      : {}),
    notBuilt: arr(d.notBuilt).filter(isObj).map((n) => ({ name: text(n.name), format: text(n.format), brief: text(n.brief) })).filter((n) => n.name),
  }
}

function metaDraft(d: Record<string, unknown>, meta: MetaIds | null, proposal: ProposalSource | null, problems: string[], notes: string[]) {
  const pages = meta?.pages ?? []
  const given = text(d.pageId)
  // The account's only page is safe to fill in; otherwise only a page the account already uses.
  const pageId = pages.includes(given) ? given : pages.length === 1 ? pages[0] : null
  if (given && !pages.includes(given)) notes.push("Claude suggested a Facebook page the account doesn't use, so it was left out. Pick the page on the plan.")
  const s = isObj(d.adSet) ? d.adSet : {}
  const t = isObj(s.targeting) ? s.targeting : {}
  const px = isObj(s.pixel) ? { pixelId: text(s.pixel.pixelId), event: text(s.pixel.event) } : null
  // The account's own conversion, so a custom conversion keeps its id.
  const pixel = (px && meta?.pixels.find((p) => p.pixelId === px.pixelId && p.event === px.event)) || null
  if (px && !pixel) notes.push("Claude suggested a pixel or event the account doesn't use, so it was left out. Pick it on the plan.")
  const base = meta?.adSets.find((a) => a.id === text(t.baseAdSetId)) ?? null
  if (text(t.baseAdSetId) && !base) notes.push("Claude named an ad set to copy the audience from that isn't one of the account's, so the audience starts fresh.")
  return {
    ...d,
    pageId,
    adSet: {
      ...s,
      endDate: text(s.endDate) || null,
      pixel,
      targeting: {
        ...t,
        baseAdSetId: base?.id ?? null,
        baseAdSetName: base?.name ?? "",
        countries: strs(t.countries).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
        // Audience ids only come from the base ad set or the team.
        customAudiences: [],
        excludedAudiences: [],
      },
    },
    ads: arr(d.ads).filter(isObj).map((raw) => {
      const { image, ...a } = raw
      const picked = proposal && typeof image === "number" ? proposal.images.find((x) => x.n === image) : undefined
      if (picked && !picked.path) problems.push(`${text(a.name) || "An ad"} uses image ${picked.n}, which couldn't be copied (see above). Upload it on the ad, or fix it in Notion and plan again.`)
      else if (proposal?.images.some((x) => x.path) && (a.format ?? "single_image") === "single_image" && !picked) problems.push(`${text(a.name) || "An ad"} has no image from the proposal. Upload one on the ad.`)
      return { ...a, description: text(a.description), creativeBrief: text(a.creativeBrief), fromProposal: Boolean(proposal && a.fromProposal), imagePath: picked?.path ?? null, leadFormId: null }
    }),
    notBuilt: arr(d.notBuilt).filter(isObj).map((n) => ({ name: text(n.name), format: text(n.format), brief: text(n.brief) })).filter((n) => n.name),
  }
}

function redditDraft(d: Record<string, unknown>) {
  const g = isObj(d.adGroup) ? d.adGroup : {}
  const t = isObj(g.targeting) ? g.targeting : {}
  return {
    ...d,
    adGroup: {
      ...g,
      bid: typeof g.bid === "number" && g.bid > 0 ? g.bid : null,
      endDate: text(g.endDate) || null,
      targeting: { geolocations: strs(t.geolocations).map((x) => x.toUpperCase()), communities: strs(t.communities).map((x) => x.replace(/^\/?r\//i, "")), interests: strs(t.interests), keywords: strs(t.keywords) },
    },
    ads: arr(d.ads).filter(isObj).map((a) => ({ ...a, postId: /^t3_\w+$/.test(text(a.postId)) ? text(a.postId) : null, clickUrl: text(a.clickUrl), headline: text(a.headline), body: text(a.body), creativeBrief: text(a.creativeBrief), fromProposal: Boolean(a.fromProposal) })),
    notBuilt: arr(d.notBuilt).filter(isObj).map((n) => ({ name: text(n.name), format: text(n.format), brief: text(n.brief) })).filter((n) => n.name),
  }
}

/**
 * Claude's plan → something the platformPlan schema accepts: the platform set, ids made safe,
 * proposal images placed, and the proposal on the plan with anything that couldn't be used.
 */
export function normalizePlatformPlan(platform: OtherPlatform, raw: unknown, o: { proposal: ProposalSource | null; meta: MetaIds | null }): unknown {
  if (!isObj(raw)) return raw
  const draft = isObj(raw.draft) ? raw.draft : {}
  const problems = [...(o.proposal?.problems ?? [])]
  // Ids that were dropped go with the risks, so the team sees them with or without a proposal.
  const notes: string[] = []
  const tidy =
    platform === "google_ads" || platform === "microsoft_ads" ? searchDraft(platform, draft)
    : platform === "meta" ? metaDraft(draft, o.meta, o.proposal, problems, notes)
    : redditDraft(draft)
  const risks = [...notes, ...strs(raw.risks)].slice(0, 6)
  return { ...raw, platform, draft: tidy, risks, proposal: o.proposal ? { ...o.proposal, problems } : null }
}
