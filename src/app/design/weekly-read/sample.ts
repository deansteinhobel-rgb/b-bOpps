// Made-up numbers for the weekly read prototype (/design/weekly-read). Nothing here is real client data.
import type { Platform } from "@/lib/metrics/types"

export type Tone = "good" | "bad" | "neutral"
export type IconKey = "doc" | "image" | "search" | "wallet" | "repeat" | "users" | "building" | "target" | "bolt" | "trend-up" | "trend-down" | "title" | "refresh" | "split"

/** One item in the three columns: a title, one line of evidence, and maybe one action. */
/** `ads`: preview slots (see page.tsx) for the specific ads an item names, shown as thumbnails. */
export type ReadItem = { icon: IconKey; title: string; tag?: string; detail: string; platform?: Platform; action?: string; ads?: string[] }
export type Tile = { label: string; hint?: string; now: string; before: string; change: string; tone: Tone; spark: number[] }
export type Flag = { kind: string; subject: string; detail: string; platform?: Platform; ad?: string }

export type WeeklyRead = {
  verdict: { headline: string; tone: Tone; body: string; trend: number[]; trendLabel: string }
  working: ReadItem[]
  attention: ReadItem[]
  act: ReadItem[]
  tiles: Tile[]
  green: Flag[]
  red: Flag[]
}

export const WEEK = { label: "Last week", dates: "12–18 Oct 2026", vs: "5–11 Oct" }

// ---------- Overall: every platform, judged on results and cost per result ----------

export const overall: WeeklyRead = {
  verdict: {
    headline: "More results for less: 41 results at $187 each, under the $200 target",
    tone: "good",
    body: "Results rose to 41 from 33 and cost per result fell to $187 from $226, mostly thanks to LinkedIn document ads. Meta is the weak spot: $1,240 spent for 2 results. October is 58% through and 61% of the budget is spent, so pacing is about right.",
    trend: [22, 27, 25, 31, 29, 35, 33, 41],
    trendLabel: "Results, last 8 weeks",
  },
  working: [
    { icon: "doc", title: "Document ads", tag: "Best format", detail: "18 results at $142 each, on 44% of LinkedIn spend", platform: "linkedin", ads: ["doc-1", "doc-2", "doc-3"] },
    { icon: "doc", title: "The ABA Audit Wave (document 2)", tag: "Best ad", detail: "6 results at $98, the lowest cost per result this week", platform: "linkedin", ads: ["doc-1"] },
    { icon: "search", title: "Brand search", tag: "Cheaper", detail: "Cost per conversion down to $61 from $88", platform: "google_ads", ads: ["search-1"] },
  ],
  attention: [
    { icon: "wallet", title: "Meta prospecting", tag: "Over target", detail: "$1,240 spent, 2 results ($620 each against $200)", platform: "meta", action: "Open the campaign" },
    { icon: "repeat", title: "SMB retargeting", tag: "Frequency rising", detail: "Frequency 6.1, up from 3.9 the week before", platform: "meta" },
    { icon: "search", title: "4 search terms with no conversions", tag: "Wasted spend", detail: "$410 between them in the last 30 days", platform: "google_ads", action: "Review terms" },
  ],
  act: [
    { icon: "split", title: "Move $1.5k from Meta to LinkedIn documents", detail: "Documents return results at $142 against Meta's $620", action: "Make it a sprint test" },
    { icon: "search", title: "Add 3 converting search terms as keywords", detail: "2+ conversions each in 30 days, not keywords yet", platform: "google_ads", action: "Review terms" },
    { icon: "refresh", title: "Refresh 4 tired ads", detail: "Live 45+ days and CTR down 30% on their first two weeks", action: "Plan a refresh", ads: ["meta-2", "img-2", "img-3", "meta-3"] },
  ],
  tiles: [
    { label: "Spend", now: "$7,670", before: "$7,458", change: "+3%", tone: "neutral", spark: [6900, 7200, 7100, 7400, 7300, 7500, 7458, 7670] },
    { label: "Results", hint: "Conversions plus leads.", now: "41", before: "33", change: "+24%", tone: "good", spark: [22, 27, 25, 31, 29, 35, 33, 41] },
    { label: "Cost per result", hint: "Spend divided by results. Target $200.", now: "$187", before: "$226", change: "−17%", tone: "good", spark: [314, 267, 284, 239, 252, 214, 226, 187] },
    { label: "Clicks", now: "1,284", before: "1,190", change: "+8%", tone: "good", spark: [1010, 1080, 1120, 1150, 1100, 1210, 1190, 1284] },
    { label: "CTR", hint: "Clicks divided by impressions.", now: "0.71%", before: "0.66%", change: "+0.05 pts", tone: "good", spark: [0.6, 0.62, 0.64, 0.63, 0.61, 0.67, 0.66, 0.71] },
  ],
  green: [
    { kind: "Best ad", subject: "The ABA Audit Wave (document 2)", detail: "6 results at $98", platform: "linkedin", ad: "doc-1" },
    { kind: "Best ad", subject: "What “AI-native” actually means (document 1)", detail: "4 results at $121", platform: "linkedin", ad: "doc-2" },
    { kind: "Best format", subject: "Document ads", detail: "18 results at $142 across 20 ads", platform: "linkedin" },
    { kind: "Cheaper", subject: "Brand search", detail: "$61 a conversion, down from $88", platform: "google_ads" },
    { kind: "Settings", subject: "Audience Network off on every LinkedIn campaign", detail: "Spend stays on LinkedIn, on the people you chose", platform: "linkedin" },
  ],
  red: [
    { kind: "Over target", subject: "Meta prospecting", detail: "$620 a result against $200", platform: "meta" },
    { kind: "No results", subject: "SMB | Benchmarks single image", detail: "$412 in 14 days, no results", platform: "linkedin", ad: "img-1" },
    { kind: "Tired ad", subject: "Denials playbook carousel", detail: "Live 63 days, CTR 0.31% down from 0.74%", platform: "meta", ad: "meta-2" },
    { kind: "Wasted spend", subject: "“free medical billing software”", detail: "$184, no conversions", platform: "google_ads" },
    { kind: "Budget", subject: "LinkedIn", detail: "71% of October's budget spent, 58% of the month gone", platform: "linkedin" },
  ],
}

export type PlatformRow = { platform: Platform; spend: number; results: number; cpr: number; target: number; change: string; tone: Tone; budget: number; mtd: number; expected: number }
export const platformRows: PlatformRow[] = [
  { platform: "linkedin", spend: 4980, results: 31, cpr: 161, target: 200, change: "−21%", tone: "good", budget: 14000, mtd: 9940, expected: 8120 },
  { platform: "google_ads", spend: 1450, results: 8, cpr: 181, target: 200, change: "−9%", tone: "good", budget: 6000, mtd: 3210, expected: 3480 },
  { platform: "meta", spend: 1240, results: 2, cpr: 620, target: 200, change: "+64%", tone: "bad", budget: 5000, mtd: 2740, expected: 2900 },
]

export type AdRow = { ad: string; name: string; platform: Platform; format: string; results: number; cpr: number | null; ctr: number; spend: number }
export const topAds: AdRow[] = [
  { ad: "doc-1", name: "The ABA Audit Wave (document 2)", platform: "linkedin", format: "Document", results: 6, cpr: 98, ctr: 0.62, spend: 588 },
  { ad: "doc-2", name: "What “AI-native” actually means (document 1)", platform: "linkedin", format: "Document", results: 4, cpr: 121, ctr: 0.35, spend: 484 },
  { ad: "doc-3", name: "New SUD funding: can your billing keep up?", platform: "linkedin", format: "Document", results: 4, cpr: 139, ctr: 0.26, spend: 556 },
  { ad: "search-1", name: "Camber | Brand | Exact", platform: "google_ads", format: "Search", results: 5, cpr: 61, ctr: 9.4, spend: 305 },
  { ad: "doc-4", name: "Multi-state expansion checklist", platform: "linkedin", format: "Document", results: 3, cpr: 168, ctr: 0.15, spend: 504 },
  { ad: "img-4", name: "Clean claims in five steps", platform: "linkedin", format: "Single image", results: 2, cpr: 214, ctr: 0.41, spend: 428 },
  { ad: "meta-1", name: "RCM for ABA clinics | Lead form", platform: "meta", format: "Static", results: 2, cpr: 297, ctr: 0.88, spend: 594 },
  { ad: "search-2", name: "Revenue audit | Non-brand", platform: "google_ads", format: "Search", results: 2, cpr: 236, ctr: 3.1, spend: 472 },
]

// ---------- ABX: named target accounts on LinkedIn ----------

export const abx: WeeklyRead = {
  verdict: {
    headline: "Target accounts are warming up: 38 engaged this week, up from 29",
    tone: "good",
    body: "ABX ads reached 212 of the 340 target accounts. 6 accounts are surging, clicking at 3x the list's average. 9 accounts took $1,860 over 4 weeks without a landing page click, and the Consultant job title is taking spend it shouldn't.",
    trend: [14, 17, 19, 18, 23, 26, 29, 38],
    trendLabel: "Engaged accounts, last 8 weeks",
  },
  working: [
    { icon: "doc", title: "Document ads", tag: "Best format", detail: "0.12% LP CTR across 20 ads, twice the account average", platform: "linkedin", ads: ["doc-1", "doc-5", "doc-6"] },
    { icon: "trend-up", title: "6 surging accounts", tag: "Showing intent", detail: "Stanford Health Care, UHS, Acadia Healthcare and 3 more", platform: "linkedin" },
    { icon: "target", title: "Enterprise contact list", tag: "Reach", detail: "61% of the list reached, up from 48%", platform: "linkedin" },
  ],
  attention: [
    { icon: "wallet", title: "1 ad set at its daily cap all week", tag: "Capped", detail: "$120 a day against $120 budgeted", platform: "linkedin", action: "Brief the team" },
    { icon: "repeat", title: "ABX frequency", tag: "Rising", detail: "6 per account, up from 3.9 the week before", platform: "linkedin" },
    { icon: "title", title: "Consultant job title", tag: "Off ICP", detail: "$101 spent, 6 clicks, outside the titles we target", platform: "linkedin" },
  ],
  act: [
    { icon: "split", title: "Move budget to documents", detail: "0.12% LP CTR against 0.06% on average, 46% of spend", action: "Make it a sprint test" },
    { icon: "users", title: "Share 5 engaged accounts with the AMs", detail: "CTR 1% or better, highest among the target list", action: "Copy the list" },
    { icon: "building", title: "Exclude 3 accounts going nowhere", detail: "$1,240 between them, no landing page clicks in 60 days", action: "Copy for LinkedIn" },
  ],
  tiles: [
    { label: "Accounts reached", hint: "Target accounts that saw at least one ad, last 30 days.", now: "212 / 340", before: "188", change: "+24", tone: "good", spark: [140, 152, 160, 171, 176, 182, 188, 212] },
    { label: "Engaged accounts", hint: "Target accounts with a click or a lead form open.", now: "38", before: "29", change: "+31%", tone: "good", spark: [14, 17, 19, 18, 23, 26, 29, 38] },
    { label: "Surging", hint: "Accounts clicking at 3x the list's average.", now: "6", before: "4", change: "+2", tone: "good", spark: [1, 2, 2, 3, 2, 3, 4, 6] },
    { label: "LP CTR", hint: "Landing page clicks divided by impressions.", now: "0.12%", before: "0.06%", change: "2x", tone: "good", spark: [0.05, 0.06, 0.05, 0.07, 0.06, 0.08, 0.06, 0.12] },
    { label: "ABX spend", now: "$2,840", before: "$1,810", change: "+57%", tone: "neutral", spark: [1500, 1620, 1700, 1650, 1780, 1820, 1810, 2840] },
  ],
  green: [
    { kind: "Surging", subject: "Stanford Health Care", detail: "CTR 3.83% on 209 impressions" },
    { kind: "Surging", subject: "Shore Capital Partners", detail: "CTR 3.18% on 157 impressions" },
    { kind: "Surging", subject: "Acadia Healthcare", detail: "CTR 2.37% on 253 impressions" },
    { kind: "Best ad", subject: "The ABA Audit Wave (document 2)", detail: "LP CTR 0.62% on 162 impressions", platform: "linkedin", ad: "doc-1" },
    { kind: "Best ad", subject: "What “AI-native” actually means (document 1)", detail: "LP CTR 0.35% on 282 impressions", platform: "linkedin", ad: "doc-2" },
    { kind: "Settings", subject: "Audience Network and expansion off on 19 ad sets", detail: "Spend stays on the accounts you targeted", platform: "linkedin" },
  ],
  red: [
    { kind: "Going nowhere", subject: "Power Digital Marketing", detail: "7 clicks, no landing page visit in 60 days" },
    { kind: "Big spend, no click", subject: "Encompass Health", detail: "$765 in 4 weeks" },
    { kind: "Went quiet", subject: "Children's Specialized ABA", detail: "26 clicks before, none in the last 30 days" },
    { kind: "Off ICP", subject: "Consultant", detail: "$101 spent, 6 clicks" },
    { kind: "Budget nearly used", subject: "ABX", detail: "92% of the $33,062 total budget spent" },
  ],
}

export type FormatRow = { format: string; ads: string[]; lpCtr: number; lpCpc: number | null; impressions: number; clicks: number; lpClicks: number; spend: number }
export const formats: FormatRow[] = [
  { format: "Document", ads: ["doc-1", "doc-5", "doc-6"], lpCtr: 0.12, lpCpc: 101.51, impressions: 11244, clicks: 166, lpClicks: 13, spend: 1319.66 },
  { format: "Single image", ads: ["img-1", "img-2", "img-3"], lpCtr: 0, lpCpc: null, impressions: 7361, clicks: 52, lpClicks: 0, spend: 1528.58 },
  { format: "Follower", ads: [], lpCtr: 0, lpCpc: null, impressions: 1872, clicks: 0, lpClicks: 0, spend: 0 },
]

export type AccountRow = { name: string; ctr: number; impressions: number; clicks: number; spend: number; campaigns: number; trend: number[]; reason?: string }
export const prioritize: AccountRow[] = [
  { name: "Parallel ENT & Allergy", ctr: 8.77, impressions: 114, clicks: 10, spend: 98, campaigns: 2, trend: [0, 1, 1, 3, 5] },
  { name: "Odyssey House", ctr: 6.45, impressions: 124, clicks: 8, spend: 112, campaigns: 1, trend: [1, 0, 2, 2, 3] },
  { name: "American Addiction Centers", ctr: 5.88, impressions: 204, clicks: 12, spend: 187, campaigns: 3, trend: [1, 2, 2, 3, 4] },
  { name: "JPA Health", ctr: 5.71, impressions: 105, clicks: 6, spend: 91, campaigns: 1, trend: [0, 0, 1, 2, 3] },
  { name: "Rogers Behavioral Health", ctr: 5.51, impressions: 127, clicks: 7, spend: 104, campaigns: 2, trend: [1, 1, 1, 2, 2] },
  { name: "Stanford Health Care", ctr: 3.83, impressions: 209, clicks: 8, spend: 176, campaigns: 2, trend: [0, 1, 2, 2, 3] },
  { name: "Shore Capital Partners", ctr: 3.18, impressions: 157, clicks: 5, spend: 139, campaigns: 1, trend: [1, 1, 1, 1, 1] },
]
export const watch: AccountRow[] = [
  { name: "Power Digital Marketing", ctr: 1.1, impressions: 640, clicks: 7, spend: 402, campaigns: 2, trend: [2, 2, 1, 1, 1], reason: "7 clicks, no landing page visit in 60 days" },
  { name: "Encompass Health", ctr: 0.4, impressions: 1810, clicks: 7, spend: 765, campaigns: 3, trend: [2, 2, 1, 1, 1], reason: "$765 in 4 weeks, no landing page visit" },
  { name: "Children's Specialized ABA", ctr: 0, impressions: 420, clicks: 0, spend: 188, campaigns: 1, trend: [9, 8, 6, 3, 0], reason: "26 clicks before, none in the last 30 days" },
  { name: "BDT & MSD Partners", ctr: 0.9, impressions: 2790, clicks: 25, spend: 512, campaigns: 2, trend: [5, 6, 5, 5, 4], reason: "25 clicks, not a target account" },
]

export type TitleRow = { title: string; inIcp: boolean; spend: number; clicks: number; engagements: number; note: string }
export const titles: TitleRow[] = [
  { title: "Revenue Cycle Director", inIcp: true, spend: 412, clicks: 21, engagements: 38, note: "Best CTR among the titles we target" },
  { title: "Chief Financial Officer", inIcp: true, spend: 388, clicks: 14, engagements: 26, note: "On target" },
  { title: "Practice Manager", inIcp: true, spend: 301, clicks: 12, engagements: 19, note: "On target" },
  { title: "Consultant", inIcp: false, spend: 101.32, clicks: 6, engagements: 9, note: "Not a title we target" },
  { title: "Student", inIcp: false, spend: 34.1, clicks: 2, engagements: 3, note: "Not a title we target" },
]

// ABX top ads: LinkedIn only, ranked by landing page clicks (ABX is judged on reaching the site).
export type AbxAdRow = { ad: string; name: string; lpClicks: number; lpCtr: number; lpCpc: number; impressions: number; spend: number }
export const abxAds: AbxAdRow[] = [
  { ad: "doc-3", name: "New SUD funding: can your billing keep up?", lpClicks: 2, lpCtr: 0.26, lpCpc: 85.15, impressions: 765, spend: 170.3 },
  { ad: "doc-4", name: "How multi-state expansion breaks billing", lpClicks: 2, lpCtr: 0.15, lpCpc: 24.99, impressions: 1350, spend: 49.98 },
  { ad: "doc-1", name: "The ABA Audit Wave (document 2)", lpClicks: 1, lpCtr: 0.62, lpCpc: 22.09, impressions: 162, spend: 22.09 },
  { ad: "doc-5", name: "The ABA Audit Wave (document 1)", lpClicks: 1, lpCtr: 0.37, lpCpc: 22.09, impressions: 272, spend: 22.09 },
  { ad: "doc-2", name: "What “AI-native” actually means (document 1)", lpClicks: 1, lpCtr: 0.35, lpCpc: 30.29, impressions: 282, spend: 30.29 },
  { ad: "doc-6", name: "Cardiology billing benchmarks", lpClicks: 1, lpCtr: 0.21, lpCpc: 41.1, impressions: 476, spend: 41.1 },
  { ad: "img-1", name: "SMB Audience | Benchmarks for ABA", lpClicks: 0, lpCtr: 0, lpCpc: 0, impressions: 2140, spend: 412 },
]
