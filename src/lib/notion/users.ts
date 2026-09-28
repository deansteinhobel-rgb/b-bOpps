import "server-only"
import { NOTION_VERSION } from "./config"
import { readOnlyNotion } from "./readonly"
import { throttled } from "./throttle"

export type NotionPerson = { id: string; name: string; email: string | null }

/** Workspace people, for linking an invite to a Notion user. Read-only. */
export async function listNotionPeople(): Promise<NotionPerson[]> {
  const token = process.env.NOTION_TOKEN
  if (!token) return []
  const notion = readOnlyNotion(token, NOTION_VERSION)
  const people: NotionPerson[] = []
  let cursor: string | undefined
  do {
    const res = await throttled(() => notion.users.list({ start_cursor: cursor, page_size: 100 }))
    for (const u of res.results) {
      if (u.type === "person") people.push({ id: u.id, name: u.name ?? u.id, email: u.person?.email ?? null })
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return people.sort((a, b) => a.name.localeCompare(b.name))
}
