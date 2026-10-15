import { describe, expect, it } from "vitest"
import { cleanPlacement, cleanSequence, HANDOFF } from "./suggestions"

const CODES = new Set(["C01", "C02", "C03"])

describe("cleanSequence", () => {
  it("keeps known codes and the handoff in email 3", () => {
    const s = cleanSequence({ email1: { id: "C02", angle: "Go deeper" }, email2: { id: "C03", angle: "“Adjacent”" }, email3: { id: HANDOFF, angle: "Talk to us" } }, CODES, "C01")
    expect(s).toEqual([
      { slot: 1, target: "C02", angle: "Go deeper" },
      { slot: 2, target: "C03", angle: "Adjacent" },
      { slot: 3, target: "handoff", angle: "Talk to us" },
    ])
  })

  it("drops unknown codes, the piece itself, repeats and an early handoff", () => {
    const s = cleanSequence({ email1: { id: HANDOFF, angle: "x" }, email2: { id: "C01", angle: "x" }, email3: { id: "C99", angle: "x" } }, CODES, "C01")
    expect(s.map((e) => e.target)).toEqual([null, null, null])
    expect(s.every((e) => e.angle === "")).toBe(true)
    expect(cleanSequence({ email1: { id: "C02" }, email2: { id: "C02" } }, CODES, null).map((e) => e.target)).toEqual(["C02", null, null])
  })

  it("survives a missing or broken answer", () => {
    expect(cleanSequence(null, CODES, null).map((e) => e.target)).toEqual([null, null, null])
  })
})

describe("cleanPlacement", () => {
  const cfg = { verticals: ["ABA clinics", "SUD clinics"] }

  it("keeps the client's verticals and a known stage, and checks the changes", () => {
    const p = cleanPlacement(
      {
        theme: "Payer oversight",
        stage: "Consideration",
        purpose: "Explains audits.",
        verticals: ["ABA clinics", "Mars clinics", "ABA clinics"],
        sequence: { email1: { id: "C02", angle: "a" } },
        changes: [
          { engagedId: "C03", slot: "email2", angle: "b", reason: "Better fit" },
          { engagedId: "C03", slot: "email2", angle: "dup", reason: "" },
          { engagedId: "C99", slot: "email1", angle: "c", reason: "" },
          { engagedId: "C01", slot: "email7", angle: "d", reason: "" },
        ],
      },
      cfg,
      CODES,
    )
    expect(p.stage).toBe("Consideration")
    expect(p.verticals).toEqual(["ABA clinics"])
    expect(p.sequence[0]).toEqual({ slot: 1, target: "C02", angle: "a" })
    expect(p.changes).toEqual([{ engaged: "C03", slot: 2, angle: "b", reason: "Better fit" }])
  })

  it("falls back to Awareness for an unknown stage and caps changes at three", () => {
    const changes = ["C01", "C02", "C03"].flatMap((c) => [1, 2].map((s) => ({ engagedId: c, slot: `email${s}`, angle: "x", reason: "y" })))
    const p = cleanPlacement({ stage: "Purchase", changes }, cfg, CODES)
    expect(p.stage).toBe("Awareness")
    expect(p.changes).toHaveLength(3)
  })
})
