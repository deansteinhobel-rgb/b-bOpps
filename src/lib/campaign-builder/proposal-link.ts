/**
 * Finds a Notion page link in what the team pasted as the proposal (Dean, 2026-10-21: a proposal
 * shared from Notion brings its images and ad copy into the plan). Plain module, tested.
 * Handles notion.com (app.notion.com/p/…, Notion's links since 2026), notion.so and notion.site links,
 * page ids with or without dashes, and the `?p=` peek link a page opened from a database row gets.
 */
const LINK = /https:\/\/(?:[a-z0-9-]+\.)?notion\.(?:com|so|site)\/[^\s)>\]"']*/gi
const ID = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/gi

const uuid = (m: RegExpMatchArray) => `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toLowerCase()

export function notionPageIdIn(text: string | null | undefined): { id: string; url: string } | null {
  for (const url of (text ?? "").match(LINK) ?? []) {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      continue
    }
    const peek = u.searchParams.get("p")
    const fromPeek = peek ? [...peek.matchAll(ID)][0] : undefined
    if (fromPeek) return { id: uuid(fromPeek), url }
    // The page id is the last id in the path (a workspace or parent can come before it).
    const ids = [...u.pathname.matchAll(ID)]
    if (ids.length) return { id: uuid(ids[ids.length - 1]), url }
  }
  return null
}

/** A Notion link with no page id in it (a workspace or a view): the planner stops instead of guessing. */
export const hasNotionLink = (text: string | null | undefined) => (text ?? "").match(LINK) !== null
