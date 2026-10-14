import { describe, expect, it } from "vitest"
import { decodeEntities, pageFromHtml, readCapped } from "./page-text"

const HTML = `<!doctype html><html><head>
<title>The ABA audit wave | Camber</title>
<meta name="description" content="What&#39;s happening &amp; why now">
<link rel="canonical" href="https://www.camber.health/resources/insights/aba-audit-wave">
<script>window.track('x')</script><style>.a{color:red}</style>
</head><body><header><nav>Menu Pricing Login</nav></header>
<main><h1>The ABA audit wave</h1><p>Payers are auditing ABA claims&nbsp;more often.</p>
<!-- hidden note --><ul><li>Documentation gaps</li><li>Unit limits</li></ul>
<form><input name="email"><button>Download</button></form></main>
<footer>© Camber</footer></body></html>`

describe("pageFromHtml", () => {
  it("reads the title, description, canonical link and main text", () => {
    const p = pageFromHtml(HTML, ["camber.health"])
    expect(p.title).toBe("The ABA audit wave | Camber")
    expect(p.description).toBe("What's happening & why now")
    expect(p.canonicalUrl).toBe("https://www.camber.health/resources/insights/aba-audit-wave")
    expect(p.text).toBe("The ABA audit wave\nPayers are auditing ABA claims more often.\nDocumentation gaps\nUnit limits")
    expect(p.words).toBe(15)
  })

  it("leaves out scripts, navigation, forms, comments and the footer", () => {
    const p = pageFromHtml(HTML, ["camber.health"])
    for (const gone of ["track", "color:red", "Pricing", "Download", "hidden note", "©"]) expect(p.text).not.toContain(gone)
  })

  it("drops a canonical link that points off the client's site", () => {
    expect(pageFromHtml(HTML.replace("www.camber.health", "evil.example"), ["camber.health"]).canonicalUrl).toBeNull()
    expect(pageFromHtml(HTML, []).canonicalUrl).toBeNull()
  })

  it("prefers og:title and falls back to the body without a main element", () => {
    const p = pageFromHtml(`<meta property="og:title" content="Guide"><body><p>Hello</p></body>`)
    expect(p.title).toBe("Guide")
    expect(p.text).toBe("Hello")
  })
})

describe("decodeEntities", () => {
  it("decodes named and numeric entities and leaves unknown ones", () => {
    expect(decodeEntities("A &amp; B &#8217; &#x2014; &unknown;")).toBe("A & B ’ — &unknown;")
  })
})

describe("readCapped", () => {
  const stream = (chunks: string[]) => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled < chunks.length) c.enqueue(new TextEncoder().encode(chunks[pulled++]))
        else c.close()
      },
    }, { highWaterMark: 0 }) // pull only when read
    return { body, pulled: () => pulled }
  }

  it("reads a body under the cap", async () => {
    const s = stream(["<p>he", "llo</p>"])
    expect(await readCapped(new Response(s.body), 100)).toBe("<p>hello</p>")
  })

  it("stops reading as soon as the body passes the cap", async () => {
    const s = stream(["aaaa", "bbbb", "cccc", "dddd"])
    await expect(readCapped(new Response(s.body), 6)).rejects.toThrow(/too large/)
    expect(s.pulled()).toBeLessThan(4)
  })

  it("refuses a declared length over the cap without reading", async () => {
    const s = stream(["x"])
    const res = new Response(s.body, { headers: { "content-length": "999" } })
    await expect(readCapped(res, 10)).rejects.toThrow(/too large/)
    expect(s.pulled()).toBe(0)
    // The body was cancelled, so the connection is released.
    expect(res.bodyUsed || (await res.body!.getReader().read()).done).toBe(true)
  })
})
