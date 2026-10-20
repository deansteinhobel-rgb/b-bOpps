import { describe, expect, it } from "vitest"
import { isMessageAd, parseMessageAd } from "./linkedin-message"

// The shape of a LinkedIn Ad Library detail page for a message ad (hand-made, no real ad).
const page = (buttons: string[]) => `
<div class="mt-[6px]"><div class="relative">
  <p class="font-semibold leading-[20px] text-md text-color-text">Jane Doe</p>
  <p class="sponsored-message__content mt-1 text-sm">
    <p class="spinmail-quill-editor__spin-break">Hi %FIRSTNAME%,</p><p class="spinmail-quill-editor__spin-break"><br></p>
    <p class="spinmail-quill-editor__spin-break">Join us at <strong>Rival Exchange</strong> on October 13 &amp; meet the team.</p>
    <p class="spinmail-quill-editor__spin-break">Seats are limited. <a href="https://rival.example/exchange?utm_source=linkedin&amp;utm_medium=paid" target="_blank"><strong>Reserve your spot →</strong></a></p>
  </p>
  <button class="absolute right-0 bottom-0 sponsored-message__truncation-button">…see more</button>
</div>
<div class="mt-1.5 flex flex-col gap-y-1.5">
  ${buttons.map((b) => `<div class="tooltip w-fit"><button class="btn-sm btn-secondary-emphasis text-color-action" disabled>\n ${b}\n</button></div>`).join("")}
</div></div>`

describe("parseMessageAd", () => {
  it("reads the sender, the message, its button and the landing page", () => {
    expect(parseMessageAd(page(["Reserve My Spot"]))).toEqual({
      sender: "Jane Doe",
      body: "Hi %FIRSTNAME%,\n\nJoin us at Rival Exchange on October 13 & meet the team.\nSeats are limited. Reserve your spot →",
      ctas: ["Reserve My Spot"],
      landing_url: "https://rival.example/exchange",
    })
  })
  it("keeps every choice of a conversation ad", () => {
    expect(parseMessageAd(page(["Book a demo", "Send me the guide", "Not now"]))?.ctas).toEqual(["Book a demo", "Send me the guide", "Not now"])
  })
  it("returns nothing for a page without a message (a sign-in wall)", () => {
    expect(parseMessageAd("<html><body>Sign in to LinkedIn</body></html>")).toBeNull()
  })
})

describe("isMessageAd", () => {
  it("knows LinkedIn's message and conversation formats", () => {
    expect(isMessageAd("sponsored_inmails")).toBe(true)
    expect(isMessageAd("sponsored_conversation")).toBe(true)
    expect(isMessageAd("sponsored_status_update")).toBe(false)
    expect(isMessageAd(null)).toBe(false)
  })
})

describe("plain text only", () => {
  it("drops markup, including markup that was escaped in the page", () => {
    const html = `<p class="font-semibold x">A</p><p class="sponsored-message__content">
      <p>Hi &lt;script&gt;alert(1)&lt;/script&gt; there <img src=x onerror=alert(1)</p></p>
      <button class="x sponsored-message__truncation-button">…see more</button>`
    const body = parseMessageAd(html)?.body ?? ""
    expect(body).not.toMatch(/[<>]/)
    expect(body).toContain("Hi scriptalert(1)/script there")
  })
})
