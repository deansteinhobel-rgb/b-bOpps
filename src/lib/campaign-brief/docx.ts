import "server-only"
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx"
import { boldRuns, type DocBlock } from "./document"

const FONT = "Helvetica Neue"
const INK = "1A1A1A"
const LIME = "E4FF1A"
const GREY = "6B6B6B"

const runs = (text: string, opts: { size?: number; color?: string; bold?: boolean } = {}) =>
  boldRuns(text).map((r) => new TextRun({ text: r.text, bold: opts.bold || r.bold, font: FONT, size: opts.size ?? 21, color: opts.color ?? INK }))

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" }

function table(b: Extract<DocBlock, { t: "table" }>) {
  const widths = b.head.length === 4 ? [26, 10, 34, 30] : b.head.map(() => Math.floor(100 / b.head.length))
  const cell = (text: string, i: number, head: boolean) =>
    new TableCell({
      width: { size: widths[i] ?? 25, type: WidthType.PERCENTAGE },
      shading: head ? { type: ShadingType.CLEAR, fill: LIME, color: "auto" } : undefined,
      borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ children: runs(text || "–", { size: 19, bold: head }) })],
    })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: b.head.map((h, i) => cell(h, i, true)) }), ...b.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }))],
  })
}

/** The brief as a Word file (Dean, 2026-10-23: "export as word file"), from the same blocks as the Notion page. */
export async function briefDocx(blocks: DocBlock[]): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []
  blocks.forEach((b, i) => {
    if (b.t === "table") {
      children.push(table(b), new Paragraph({ children: [] }))
      return
    }
    if (b.t === "h1") children.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 120 }, children: runs(b.text, { size: 40, bold: true }) }))
    else if (b.t === "h2") children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: LIME, space: 4 } }, children: runs(b.text, { size: 28, bold: true }) }))
    else if (b.t === "h3") children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: runs(b.text, { size: 23, bold: true }) }))
    else if (b.t === "bullet") children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runs(b.text) }))
    // The line under the title (client · date · ads) is set smaller and grey.
    else children.push(new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.LEFT, children: runs(b.text, i === 1 ? { size: 18, color: GREY } : {}) }))
  })
  const doc = new Document({
    creator: "Lumaux",
    title: blocks.flatMap((b) => (b.t === "h1" ? [b.text] : []))[0] ?? "Campaign brief",
    styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  })
  return Packer.toBuffer(doc)
}
