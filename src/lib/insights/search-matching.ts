/**
 * How Google Ads matches searches, in plain words (Dean, 2026-09-30). Shown on the search terms
 * table and given to Claude with every ICP check, so the team and Claude read the same rules.
 * Sources: Google Ads Help "About AI Max for Search campaigns" and "About negative keywords".
 * A plain module: the server and the browser both use it.
 */

/** Windsor's search_term_match_type values, as the team should read them. */
export const MATCH_SOURCE: Record<string, { label: string; hint: string; aiMax?: boolean }> = {
  EXACT: { label: "exact", hint: "Matched an exact match keyword word for word." },
  NEAR_EXACT: { label: "exact (close variant)", hint: "A close variant of an exact match keyword: a plural, misspelling or the same meaning in other words." },
  PHRASE: { label: "phrase", hint: "Contains a phrase match keyword." },
  NEAR_PHRASE: { label: "phrase (close variant)", hint: "A close variant of a phrase match keyword." },
  BROAD: { label: "broad", hint: "Matched a broad match keyword: Google judged it related to the keyword's meaning." },
  AI_MAX: { label: "AI Max", hint: "Found by AI Max, not by one of our keywords. AI Max widens matching (broad match expansion and keywordless matching from our landing pages, ads and assets).", aiMax: true },
}

export const matchLabel = (code: string) => MATCH_SOURCE[code]?.label ?? code.toLowerCase().replace(/_/g, " ")

/** For the "How search terms match" explainer on the table. */
export const MATCHING_NOTES: { title: string; body: string }[] = [
  { title: "Keywords vs search terms", body: "Keywords are what we bid on. Search terms are what people actually typed. The match column says how each search got in." },
  { title: "AI Max", body: "A campaign setting. It finds searches beyond our keywords, and can rewrite ad text and send people to other pages on the site. Expect many more long-tail terms. It can be turned off per ad group, and has brand and URL inclusions and exclusions in Google Ads." },
  { title: "Negatives still apply", body: "Negative keywords block a search wherever it came from, AI Max and broad match included. A campaign negative covers every ad group; an ad group negative only that one." },
  { title: "No close variants", body: "Negatives don't stretch like keywords do. Exact [dns jobs] blocks only \"dns jobs\", not \"dns job\". Phrase \"jobs\" blocks any search containing jobs. Broad blocks searches with all the words in any order." },
  { title: "Careful with short negatives", body: "One word as a phrase negative can block good searches. Check that no converting term contains it. To keep our own brand out of a non-brand AI Max campaign, use brand exclusions in Google Ads rather than negatives." },
  { title: "Not every search is shown", body: "Google hides low-volume searches for privacy, so part of the spend has no visible search term." },
]

/** The same rules for Claude. */
export const MATCHING_PRIMER = `How Google Ads search matching works (use this when judging terms):
- Keywords are what we bid on; search terms are what people typed. Each search term has a match source: EXACT, PHRASE or BROAD (matched a keyword of that type), NEAR_EXACT / NEAR_PHRASE (a close variant of an exact or phrase keyword: plural, misspelling, same meaning), or AI_MAX (found by AI Max for Search: broad match expansion or keywordless matching from the landing pages, ads and assets, not by one of our keywords).
- AI Max is a campaign setting. It brings in many more, often longer-tail, searches; it can also rewrite ad text (text customisation) and send people to other pages (final URL expansion). Controls in Google Ads: search term matching can be turned off per ad group; brand inclusions/exclusions; URL inclusions/exclusions; locations of interest.
- Negative keywords apply to every search in their scope, including AI Max and broad matches. Campaign level covers every ad group; ad group level only that one.
- Negatives do NOT match close variants. EXACT negative [x] blocks only the search "x". PHRASE negative "x y" blocks any search containing "x y" in that order. BROAD negative blocks any search containing all its words in any order.
- A short phrase negative (one word such as "jobs" or "free") can block a whole theme, including good searches. Never suggest one that a converting search term contains.
- Our own brand in a non-brand AI Max campaign is better handled with brand exclusions than negatives; on a brand campaign, brand terms are the point.
- Google hides low-volume searches for privacy, so the listed terms don't add up to all the spend.`
