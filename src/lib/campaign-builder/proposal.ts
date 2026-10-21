import "server-only"
import { randomUUID } from "node:crypto"
import { APIErrorCode, isNotionClientError } from "@notionhq/client"
import { sniffImageType } from "@/lib/image-type"
import { insideOtherClient, normId, otherClientsNotion } from "@/lib/knowledge/boundaries"
import { notion, pageText, rt, type Block, type RichText } from "@/lib/knowledge/notion-hq"
import { titleNamesClient } from "./proposal-link"
import { throttled } from "@/lib/notion/throttle"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchFrom, readBytes } from "@/lib/windsor/creatives"
import type { ProposalSource } from "./plan-schema"

/**
 * A proposal shared as a Notion link (Dean, 2026-10-21): the planner uses its ad copy and images.
 * READ ONLY, through the guarded client. Never a page inside another client's tree. Pages under the
 * client's own GTM HQ are read, and so are pages elsewhere whose title names the client (Dean,
 * 2026-10-21: proposals often live outside the HQ, e.g. "… | Camber").
 * Image files are copied into campaign-assets at <client_id>/<uuid>.<ext>, like an upload, so the
 * build sends our copy. Anything that can't be used is said in words with how to fix it.
 */

/** Notion's own file storage (uploaded images come back as signed S3 links that last an hour). */
const NOTION_FILE_HOSTS = ["prod-files-secure.s3.us-west-2.amazonaws.com", "file.notion.so"]
const MAX_IMAGES = 12
const MAX_BYTES = 5 * 1024 * 1024 // LinkedIn's limit for single image ads
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" }

/** A proposal problem that stops the plan: the message says how to fix it. */
export class ProposalError extends Error {}

type ImageBlock = { type: "file" | "external" | "file_upload"; file?: { url: string }; external?: { url: string }; caption?: RichText[] }

export async function readProposal(clientId: string, link: { id: string; url: string }, reuse: ProposalSource | null): Promise<{ source: ProposalSource; text: string }> {
  const db = createAdminClient()
  const { data: client } = await db.from("clients").select("name, notion_client_option, notion_hq_page_id").eq("id", clientId).single()
  if (!client) throw new Error("Client not found.")
  const n = notion()

  let title = "Proposal"
  try {
    const page = (await throttled(() => n.pages.retrieve({ page_id: link.id }))) as unknown as { properties?: Record<string, { type: string; title?: RichText[] }> }
    const t = Object.values(page.properties ?? {}).find((p) => p.type === "title")
    title = rt(t?.title).trim() || title
  } catch (e) {
    if (isNotionClientError(e) && (e.code === APIErrorCode.ObjectNotFound || e.code === APIErrorCode.RestrictedResource))
      throw new ProposalError(`Lumaux can't open the Notion proposal. Check the link is a page (not a database view), and that it's shared with Lumaux's Notion connection (••• › Connections). Then plan again.`)
    if (isNotionClientError(e) && e.code === APIErrorCode.ValidationError) throw new ProposalError("That Notion link isn't a page. Open the proposal page itself and copy its link.")
    throw e
  }

  // Isolation first: never another client's page, and only pages under this client's own HQ.
  const others = await otherClientsNotion(clientId)
  if (await insideOtherClient(n, link.id, others)) throw new ProposalError(`"${title}" sits under another client's HQ in Notion, so Lumaux won't read it for ${client.name}.`)
  const hq = client.notion_hq_page_id ? normId(client.notion_hq_page_id) : null
  const inHq = hq !== null && (normId(link.id) === hq || (await insideOtherClient(n, link.id, new Set([hq]))))
  if (!inHq && !titleNamesClient(title, [client.name, client.notion_client_option]))
    throw new ProposalError(`"${title}" isn't under ${client.name}'s GTM HQ in Notion and its title doesn't name ${client.name}, so Lumaux won't read it for them. Add "${client.name}" to the page title (or move it into the HQ), then plan again.`)

  // The text, with each image numbered where it sits so Claude can match images to ads.
  const found: { n: number; caption: string; block: ImageBlock }[] = []
  const problems: string[] = []
  const embeds = new Set<string>()
  const text = await pageText(n, link.id, 0, others, (b: Block) => {
    const v = b.image as ImageBlock
    const caption = rt(v?.caption).trim()
    const num = found.length + 1
    found.push({ n: num, caption, block: v })
    return `[Image ${num}${caption ? `: ${caption}` : ""}]`
  })
  for (const m of text.matchAll(/\[(embed|video|file|pdf): ([^\]\s]+)/g)) embeds.add(`${m[1]} from ${hostOf(m[2])}`)
  if (embeds.size) problems.push(`The proposal has ${[...embeds].join(", ")}. Lumaux can't take images out of embeds or files: add the ad images to the page as image blocks.`)
  if (!found.length) problems.push(`"${title}" has no images. Add the ad images to the Notion page as image blocks, or upload them on each ad here.`)
  if (found.length > MAX_IMAGES) problems.push(`The proposal has ${found.length} images; Lumaux uses the first ${MAX_IMAGES}.`)

  const same = reuse && normId(reuse.pageId) === normId(link.id) ? reuse : null
  const images: ProposalSource["images"] = []
  for (const img of found.slice(0, MAX_IMAGES)) {
    const kept = same?.images.find((x) => x.n === img.n && x.caption === img.caption && x.path)
    if (kept) {
      images.push(kept)
      continue
    }
    const r = await copyProposalImage(clientId, img.block).catch((e: Error) => ({ path: null, error: e.message }))
    images.push({ n: img.n, caption: img.caption, path: r.path, error: r.error ?? null })
  }
  for (const i of images) if (i.error) problems.push(`Image ${i.n}${i.caption ? ` (${i.caption})` : ""}: ${i.error}`)

  return { source: { pageId: link.id, title, url: link.url, images, problems }, text }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return "a link"
  }
}

async function copyProposalImage(clientId: string, v: ImageBlock): Promise<{ path: string; error?: undefined }> {
  const url = v?.type === "file" ? v.file?.url : v?.type === "external" ? v.external?.url : undefined
  if (!url) throw new Error("Notion didn't return a link to this image. Upload it to the page again.")
  if (v.type === "external") throw new Error(`it's linked from ${hostOf(url)}, not uploaded to Notion. Upload the image file to the page (drag it in), then plan again.`)
  const res = await fetchFrom(NOTION_FILE_HOSTS, url, { signal: AbortSignal.timeout(20_000), cache: "no-store" })
  if (!res.ok) throw new Error(`Notion's file storage answered ${res.status}. Plan again in a minute.`)
  const bytes = await readBytes(res, MAX_BYTES, "it's over 5 MB, LinkedIn's limit. Export a smaller file (1200×627 is enough).")
  const type = sniffImageType(bytes)
  if (!type || !EXT[type]) throw new Error(`it's ${type ? type.replace("image/", "").toUpperCase() : "not an image LinkedIn takes"}. LinkedIn takes JPG, PNG or GIF: export it again as one of those.`)
  const path = `${clientId}/${randomUUID()}.${EXT[type]}`
  const { error } = await createAdminClient().storage.from("campaign-assets").upload(path, bytes, { contentType: type })
  if (error) throw new Error(`couldn't be stored (${error.message}).`)
  return { path }
}
