import { describe, expect, it } from "vitest"
import { postPageImage } from "./linkedin-post"

const OG = '<meta property="og:image" content="https://static.licdn.com/aero-v1/sc/h/c45fy346jw096z9pbphyyhdz7">'
// Trimmed from a real document ad's post page (2026-10-21): the JSON is HTML-escaped.
const DOC =
  '&quot;coverPages&quot;:[{&quot;type&quot;:&quot;image&quot;,&quot;config&quot;:{&quot;src&quot;:&quot;https://media.licdn.com/dms/image/v2/D56/ads-document-cover-images_480/B56/0/1789987592151/Doc_Ad_2pdf?e=2147483647&amp;v=beta&amp;t=AnU&quot;}},{&quot;type&quot;:&quot;image&quot;,&quot;config&quot;:{&quot;src&quot;:&quot;https://media.licdn.com/dms/image/v2/D56/ads-document-cover-images_480/B56/1/1789987592151/Doc_Ad_2pdf?e=2147483647&amp;v=beta&amp;t=XyZ&quot;}}]'

describe("postPageImage", () => {
  it("takes a document's first page over the generic og:image", () => {
    expect(postPageImage(`<head>${OG}</head><code>${DOC}</code>`)).toEqual({
      url: "https://media.licdn.com/dms/image/v2/D56/ads-document-cover-images_480/B56/0/1789987592151/Doc_Ad_2pdf?e=2147483647&v=beta&t=AnU",
      cover: true,
    })
  })

  it("falls back to the og:image for other posts", () => {
    expect(postPageImage(`<head>${OG.replace("static.licdn.com/aero-v1/sc/h/c45fy346jw096z9pbphyyhdz7", "media.licdn.com/dms/image/x.jpg?a=1&amp;b=2")}</head>`)).toEqual({ url: "https://media.licdn.com/dms/image/x.jpg?a=1&b=2", cover: false })
  })

  it("refuses images off LinkedIn's hosts", () => {
    expect(postPageImage(DOC.replaceAll("media.licdn.com", "evil.example"))).toBeNull()
    expect(postPageImage('<meta property="og:image" content="https://evil.example/x.jpg">')).toBeNull()
  })

  it("returns null when the page has no image (a sign-in wall)", () => {
    expect(postPageImage("<html><title>Sign in</title></html>")).toBeNull()
  })
})
