import type { OtherPlatform } from "./platform-plan"
import type { Preset } from "./presets"

/**
 * Campaign builder presets for Google Ads, Meta, Reddit and Microsoft Ads (Dean, 2026-10-21).
 * LinkedIn's live in presets.ts (General and ABX). Each one tells Claude what kind of campaign to plan
 * and what it must know first. `briefOnly` presets are planned and briefed, then built in the
 * platform: Windsor can't create those campaign types. A plain module: the page, the planner and the
 * tests use it.
 */
export type PlatformPreset = {
  key: string
  platform: OtherPlatform
  label: string
  description: string
  icon: Preset["icon"]
  /** Where to start: Google's bidding, Meta's objective and optimization goal, Reddit's objective. */
  start: string
  /** Planned and briefed only; built by hand in the platform. */
  briefOnly?: boolean
  /** What Claude is told about this kind of campaign. */
  guide: string
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    key: "google_search_full",
    platform: "google_ads",
    label: "Plan a full Search campaign",
    description: "Ad groups by theme, keywords, responsive search ads, sitelinks and callouts.",
    icon: "megaphone",
    start: "maximize_conversions",
    guide: "A complete Search campaign for one product or offer: tightly themed ad groups (one intent each), exact and phrase keywords, one or two responsive search ads per group, sitelinks and callouts. Propose the structure, then detail every ad group.",
  },
  {
    key: "google_search_terms",
    platform: "google_ads",
    label: "High-intent non-brand",
    description: "Built from search terms that already convert but aren't keywords yet.",
    icon: "target",
    start: "maximize_conversions",
    guide: "Non-brand Search built from the client's converting search terms that aren't keywords yet (listed in the history). Group them by theme, exact and phrase match, copy that answers each theme's intent. Never put the client's brand terms in it.",
  },
  {
    key: "google_search_competitor",
    platform: "google_ads",
    label: "Competitor search",
    description: "Bid on competitors' names with a comparison angle.",
    icon: "building",
    start: "manual_cpc",
    guide: "Competitor Search campaign: one ad group per competitor, their brand names as exact and phrase keywords, copy that compares fairly (never uses the competitor's trademark in the headline as if it were the client's) and a comparison or switch landing page. Manual CPC with a careful max CPC is the safe start.",
  },
  {
    key: "google_search_brand",
    platform: "google_ads",
    label: "Brand search",
    description: "Protect the client's own name, cheaply.",
    icon: "sparkles",
    start: "target_spend",
    guide: "Brand Search campaign: the client's brand and product names (exact and phrase), a low daily budget, copy with the main offer and sitelinks to the key pages.",
  },
  {
    key: "google_brief_only",
    platform: "google_ads",
    label: "Display, Performance Max or Demand Gen",
    description: "Planned and briefed here; built in Google Ads.",
    icon: "image",
    start: "maximize_conversions",
    briefOnly: true,
    guide: "Display, Performance Max, Demand Gen or video: plan the campaign, its audience signals and every asset (headlines, descriptions, images, videos) in notBuilt with a full brief. The app can't create these in Google Ads, so the team builds them by hand. Keep a small Search ad group in the draft only if the request asks for one.",
  },
  {
    key: "meta_lead_ads",
    platform: "meta",
    label: "Lead ads (instant form)",
    description: "Single image ads that open one of the page's instant forms.",
    icon: "file",
    start: "OUTCOME_LEADS / LEAD_GENERATION",
    guide: "Leads campaign optimizing for LEAD_GENERATION with an instant form (the team picks the form; leave leadFormId null). 3-4 single image ads testing one variable. Audience Network off.",
  },
  {
    key: "meta_conversions",
    platform: "meta",
    label: "Website conversions",
    description: "Drive trials or demos on the client's site, optimized on the pixel.",
    icon: "sparkles",
    start: "OUTCOME_LEADS / OFFSITE_CONVERSIONS",
    guide: "Website conversions to the client's landing page, optimizing for the pixel event the account already uses for that conversion (only pixel ids and events listed in the context).",
  },
  {
    key: "meta_retargeting",
    platform: "meta",
    label: "Retargeting",
    description: "Site visitors and engagers, moved to a conversion offer.",
    icon: "repeat",
    start: "OUTCOME_LEADS / OFFSITE_CONVERSIONS",
    guide: "Retargeting of website visitors and engagers with a bottom-of-funnel offer. Build on an existing retargeting ad set's audience (baseAdSetId) when one is listed; Advantage+ audience off.",
  },
  {
    key: "meta_lookalike",
    platform: "meta",
    label: "Lookalike prospecting",
    description: "Prospecting on an audience the account already runs well.",
    icon: "target",
    start: "OUTCOME_LEADS / LEAD_GENERATION",
    guide: "Prospecting built on an existing ad set's audience (lookalikes or interests) that has delivered results at or under target: set baseAdSetId to it and say why. Fresh creative and one variable per ad.",
  },
  {
    key: "reddit_communities",
    platform: "reddit",
    label: "Community targeting",
    description: "Reach the subreddits the ICP reads.",
    icon: "building",
    start: "CONVERSIONS",
    guide: "Reddit campaign targeting the communities (subreddits) and interests the ICP reads, with promoted posts written for Reddit (plain, useful, no hype).",
  },
  {
    key: "reddit_conversation",
    platform: "reddit",
    label: "Conversation ads from posts",
    description: "Promote posts that read like a useful thread.",
    icon: "user",
    start: "CLICKS",
    guide: "Promote posts in conversation placements: each ad is an existing post on the client's profile (postId), or the headline and body for the team to publish first.",
  },
  {
    key: "reddit_retargeting",
    platform: "reddit",
    label: "Retargeting",
    description: "Site visitors get a conversion offer on Reddit.",
    icon: "repeat",
    start: "CONVERSIONS",
    guide: "Retargeting of website visitors (Reddit Pixel audience; the team adds the audience in Reddit Ads) with a bottom-of-funnel offer.",
  },
  {
    key: "microsoft_mirror",
    platform: "microsoft_ads",
    label: "Mirror the best Google Search",
    description: "The Google Search campaigns that convert, rebuilt for Microsoft.",
    icon: "repeat",
    start: "MaxConversions",
    guide: "Rebuild the client's best converting Google Search campaigns (by cost per result, in the history) for Microsoft Ads: same themes, keywords and copy, a smaller budget, and say which Google campaign each ad group mirrors.",
  },
]

export const presetsForPlatform = (platform: OtherPlatform) => PLATFORM_PRESETS.filter((p) => p.platform === platform)
export const platformPresetByKey = (key: string) => PLATFORM_PRESETS.find((p) => p.key === key) ?? null
