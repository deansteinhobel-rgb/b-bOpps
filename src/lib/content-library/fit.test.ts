import { describe, expect, it } from "vitest"
import { bestPairings, pairFit, timesSent, type FitPiece, type Sequences } from "./fit"

const ALL = ["ABA clinics", "SUD clinics", "PT clinics"]
const piece = (id: string, p: Partial<FitPiece> = {}): FitPiece => ({ id, title: id, theme: null, stage: "Awareness", audiences: ["Enterprise"], verticals: ALL, ...p })
const none: Sequences = new Map()

describe("pairFit", () => {
  it("never fits pieces written for different audiences", () => {
    const fit = pairFit(piece("a", { audiences: ["SMB"], theme: "Denials" }), piece("b", { audiences: ["PE"], theme: "Denials" }), none, ALL)
    expect(fit).toEqual({ score: 0, level: 0, reasons: ["Written for different audiences"] })
  })

  it("scores theme, shared verticals and a step down the funnel", () => {
    const a = piece("a", { theme: "Denials", verticals: ["ABA clinics", "SUD clinics"] })
    const b = piece("b", { theme: "Denials", verticals: ["ABA clinics"], stage: "Decision" })
    const fit = pairFit(a, b, none, ALL)
    expect(fit.score).toBe(3 + 2 + 1)
    expect(fit.level).toBe(3)
    expect(fit.reasons).toEqual(["Same theme: Denials", "Both cover ABA clinics", "Moves them from Awareness to Decision"])
  })

  it("marks down pieces with no vertical in common", () => {
    const fit = pairFit(piece("a", { verticals: ["ABA clinics"] }), piece("b", { verticals: ["PT clinics"] }), none, ALL)
    expect(fit.score).toBe(-2)
    expect(fit.level).toBe(0)
  })

  it("counts pieces relevant to every vertical as a light match", () => {
    expect(pairFit(piece("a"), piece("b"), none, ALL).reasons).toEqual(["Both relevant to every vertical"])
    expect(pairFit(piece("a", { verticals: ["ABA clinics"] }), piece("b"), none, ALL).reasons).toEqual(["Relevant across verticals"])
  })

  it("adds the sequences already set up, both ways", () => {
    const seqs: Sequences = new Map([
      ["a", [{ slot: 2, targetId: "b" }]],
      ["b", [{ slot: 1, targetId: "a" }]],
    ])
    const fit = pairFit(piece("a"), piece("b"), seqs, ALL)
    expect(fit.score).toBe(1 + 2 + 1)
    expect(fit.reasons).toContain("Already email 2 in its sequence")
    expect(fit.reasons).toContain("Its own sequence sends readers back here")
  })

  it("doesn't count a step back up the funnel", () => {
    expect(pairFit(piece("a", { stage: "Decision" }), piece("b", { stage: "Awareness" }), none, ALL).reasons).not.toContain("Moves them from Decision to Awareness")
  })
})

describe("bestPairings", () => {
  it("ranks the strongest first, leaves out no-fit pieces and the piece itself", () => {
    const sel = piece("sel", { theme: "Denials" })
    const strong = piece("strong", { theme: "Denials", stage: "Decision" })
    const weak = piece("weak")
    const off = piece("off", { audiences: ["PE"] })
    const ranked = bestPairings(sel, [sel, weak, strong, off], none, ALL)
    expect(ranked.map((r) => r.piece.id)).toEqual(["strong"])
    expect(bestPairings(sel, [sel, weak, strong, off], new Map([["sel", [{ slot: 1, targetId: "weak" }]]]), ALL).map((r) => r.piece.id)).toEqual(["strong", "weak"])
  })
})

describe("timesSent", () => {
  it("counts other pieces' emails that send this one", () => {
    const seqs: Sequences = new Map([
      ["a", [{ slot: 1, targetId: "c" }, { slot: 2, targetId: "b" }]],
      ["b", [{ slot: 1, targetId: "c" }, { slot: 3, targetId: null }]],
      ["c", [{ slot: 1, targetId: "c" }]],
    ])
    expect(timesSent("c", seqs)).toBe(2)
    expect(timesSent("a", seqs)).toBe(0)
  })
})
