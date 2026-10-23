import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import mammoth from "mammoth"
import { FILE_BUCKET, isClientFilePath } from "@/lib/knowledge/brief"
import { createAdminClient } from "@/lib/supabase/admin"
import { ATTACH_TYPES, MAX_ATTACH_BYTES, type Attachment } from "./schema"

const MAX_TEXT = 60_000 // characters per file, like the brain's uploads

/**
 * A file someone attached to a brief, checked against what storage actually holds: the client's own
 * folder in client-files, a type Claude can read, under 10 MB (type and size never come from the
 * browser). Null when it isn't there or isn't allowed.
 */
export async function checkAttachment(clientId: string, path: string, name: string): Promise<Attachment | null> {
  if (!isClientFilePath(path, clientId)) return null
  const folder = path.slice(0, path.lastIndexOf("/"))
  const file = path.slice(path.lastIndexOf("/") + 1)
  const { data: found } = await createAdminClient().storage.from(FILE_BUCKET).list(folder, { search: file })
  const stored = found?.find((f) => f.name === file)
  const type = String(stored?.metadata?.mimetype ?? "")
  const size = Number(stored?.metadata?.size ?? 0)
  if (!stored || !ATTACH_TYPES[type] || size > MAX_ATTACH_BYTES) return null
  return { path, name: name.slice(0, 200), type, size }
}

/** The attached files as Claude content: a PDF as a document (layout and tables kept), Word and text files as text. */
export async function attachmentBlocks(clientId: string, files: Attachment[]): Promise<Anthropic.ContentBlockParam[]> {
  const db = createAdminClient()
  const blocks: Anthropic.ContentBlockParam[] = []
  for (const f of files) {
    if (!isClientFilePath(f.path, clientId)) continue
    const { data } = await db.storage.from(FILE_BUCKET).download(f.path)
    if (!data) continue
    const buf = Buffer.from(await data.arrayBuffer())
    if (f.type === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") }, title: f.name })
      continue
    }
    const text = f.type.includes("wordprocessingml") ? (await mammoth.extractRawText({ buffer: buf })).value : buf.toString("utf8")
    blocks.push({ type: "text", text: `### Attached file: ${f.name}\n${text.slice(0, MAX_TEXT)}` })
  }
  return blocks
}
