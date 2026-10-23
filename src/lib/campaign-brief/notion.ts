import { formattedRichText } from "@/lib/notion/write"
import type { DocBlock } from "./document"

/** Notion takes at most 100 blocks in one pages.create call. */
export const MAX_NOTION_BLOCKS = 100

const rich = (text: string) => formattedRichText(text).slice(0, 100)

/**
 * The brief as the body of the new Master Production page (pages.create `children`: the page is
 * created with its content, nothing is appended later). The h1 is dropped because the page title
 * carries it. Over 100 blocks, the rest is cut and the last block says to open Lumaux.
 */
export function notionChildren(blocks: DocBlock[], link: string): object[] {
  const out: object[] = []
  for (const b of blocks) {
    if (b.t === "h1") continue
    if (b.t === "h2") out.push({ object: "block", type: "heading_2", heading_2: { rich_text: rich(b.text) } })
    else if (b.t === "h3") out.push({ object: "block", type: "heading_3", heading_3: { rich_text: rich(b.text) } })
    else if (b.t === "p") out.push({ object: "block", type: "paragraph", paragraph: { rich_text: rich(b.text) } })
    else if (b.t === "bullet") out.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(b.text) } })
    else if (b.t === "table") {
      const row = (cells: string[]) => ({ object: "block", type: "table_row", table_row: { cells: cells.map((c) => rich(c || "–")) } })
      out.push({
        object: "block",
        type: "table",
        table: { table_width: b.head.length, has_column_header: true, has_row_header: false, children: [row(b.head), ...b.rows.slice(0, 99).map(row)] },
      })
    }
  }
  if (out.length <= MAX_NOTION_BLOCKS) return out
  const cut = out.slice(0, MAX_NOTION_BLOCKS - 1)
  cut.push({ object: "block", type: "paragraph", paragraph: { rich_text: rich(`The rest of the brief is in Lumaux: ${link}`) } })
  return cut
}
