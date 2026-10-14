import "server-only"
import { fetchFrom } from "@/lib/windsor/creatives"
import type { LibraryConfig } from "./config"
import { pageFromHtml, readCapped, type PageText } from "./page-text"

const MAX_BYTES = 3 * 1024 * 1024

/**
 * Reads a page on the client's own site for the content library's "Read page". Only the hosts in the
 * client's library settings, over https, with every redirect checked (fetchFrom). Throws a message
 * the person can act on when the page can't be read.
 */
export async function readClientPage(cfg: LibraryConfig, url: string): Promise<PageText> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error("That isn't a link. Paste the page's full address, starting https://")
  }
  if (u.protocol !== "https:" || !cfg.pageHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) {
    throw new Error(`Only pages on ${cfg.pageHosts[0]} can be read. Paste the page text instead.`)
  }
  let res: Response
  try {
    res = await fetchFrom(cfg.pageHosts, u.toString(), {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 Lumaux", accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    })
  } catch (e) {
    throw new Error((e as Error).message.startsWith("Not an allowed host") ? "The page redirects off the client's site, so it wasn't read." : "The page didn't respond. Try again, or paste the page text.")
  }
  if (!res.ok) throw new Error(`The page answered with an error (${res.status}). Check the link, or paste the page text.`)
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) throw new Error("That link isn't a web page. Paste the page text instead.")
  const page = pageFromHtml(await readCapped(res, MAX_BYTES), cfg.pageHosts)
  if (!page.text) throw new Error("The page had no readable text. Paste the page text instead.")
  return page
}
