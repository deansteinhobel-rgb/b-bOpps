/**
 * The image to show for a public LinkedIn post page (Dean, 2026-10-21). Document posts carry their
 * pages as images in the page's JSON ("coverPages", page 1 first), while their og:image is LinkedIn's
 * generic document tile, so a document's first page wins. Other posts use the og:image. Only
 * LinkedIn's own image hosts are accepted. Plain module, so it can be tested.
 */
const OG_IMAGE = /<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content="([^"]+)"/i
const COVER = /"coverPages":\[\{"type":"image","config":\{"src":"([^"]+)"/
const LICDN = /^https:\/\/([a-z0-9-]+\.)*licdn\.com\//i

const unescape = (s: string) => s.replaceAll("&quot;", '"').replaceAll("&amp;", "&")

export function postPageImage(html: string): { url: string; cover: boolean } | null {
  // The page embeds its data HTML-escaped (&quot;), sometimes with JSON-escaped slashes.
  const cover = unescape(html).match(COVER)?.[1].replaceAll("\\/", "/").replaceAll("\\u0026", "&")
  if (cover && LICDN.test(cover)) return { url: cover, cover: true }
  const og = html.match(OG_IMAGE)?.[1]
  const url = og ? unescape(og) : null
  return url && LICDN.test(url) ? { url, cover: false } : null
}
