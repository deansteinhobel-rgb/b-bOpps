"use client"

import { ChevronRight, ExternalLink, Search } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { Segmented } from "@/components/segmented"
import { StatusDot, type Rag } from "@/components/status-badge"
import { Input } from "@/components/ui/input"
import { bestPairings, FIT_LABEL, pairFit, timesSent, type FitLevel, type Sequences } from "@/lib/content-library/fit"
import type { LibraryEmail, LibraryPiece } from "@/lib/content-library/load"
import { longDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { libraryConfig } from "@/lib/content-library/config"
import { AddContent } from "./add-content"
import type { ApprovalSetup } from "./approve-dialog"
import { SequenceBuilder } from "./sequence-builder"

type View = "library" | "matrix" | "sequences"
const VIEWS: View[] = ["library", "matrix", "sequences"]

/** Library, Matrix and the sequence builder, from the Camber content library artifact. */
export function ContentLibrary({
  pieces,
  verticals,
  clientSlug,
  librarySlug = clientSlug,
  canEdit,
  aiEnabled,
  approval = null,
}: {
  pieces: LibraryPiece[]
  verticals: string[]
  clientSlug: string
  /** Whose library settings to use (the client itself; /design borrows Camber's). */
  librarySlug?: string
  canEdit: boolean
  aiEnabled: boolean
  /** Project Leads and whether Notion writes are live, for "Approve sequence". Null: no approving here. */
  approval?: Omit<ApprovalSetup, "allVerticals"> | null
}) {
  const cfg = libraryConfig(librarySlug)
  const add = cfg && canEdit ? <AddContent cfg={cfg} clientSlug={clientSlug} pieces={pieces} aiEnabled={aiEnabled} /> : null
  const params = useSearchParams()
  const [view, setView] = useState<View>(() => VIEWS.find((v) => v === params.get("view")) ?? "library")
  const [vertical, setVertical] = useState(() => {
    const v = params.get("vertical")
    return v && verticals.includes(v) ? v : ""
  })
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)

  // View and vertical live in the URL so a link opens the same view (no server round trip).
  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(window.location.search)
    if (value) p.set(key, value)
    else p.delete(key)
    const q = p.toString()
    window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname)
  }

  const sequences: Sequences = useMemo(() => new Map(pieces.map((p) => [p.id, p.emails.map((e) => ({ slot: e.slot, targetId: e.targetId }))])), [pieces])
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pieces.filter((p) => {
      if (vertical && !p.verticals.includes(vertical)) return false
      if (!q) return true
      return [p.title, p.theme, p.type, p.purpose, p.url, p.audiences.join(" "), p.verticals.join(" ")].some((v) => (v ?? "").toLowerCase().includes(q))
    })
  }, [pieces, vertical, query])

  if (!pieces.length) {
    return (
      <Empty title="No content yet">
        Content added to the library shows here, with the three emails to send someone who engaged with it.
        {add && <span className="mt-4 flex justify-center">{add}</span>}
      </Empty>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="View"
          value={view}
          onChange={(v) => {
            setView(v)
            setParam("view", v === "library" ? "" : v)
          }}
          options={[
            { value: "library", label: "Library", count: pieces.length },
            { value: "matrix", label: "Matrix" },
            { value: "sequences", label: "Sequence builder", count: pieces.filter((p) => p.seqStatus === "pending").length || undefined, title: "Sequences awaiting approval" },
          ]}
        />
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <select
            aria-label="Filter by vertical"
            value={vertical}
            onChange={(e) => {
              setVertical(e.target.value)
              setParam("vertical", e.target.value)
            }}
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-input/30 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none"
          >
            <option value="">All verticals</option>
            {verticals.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search content" aria-label="Search content" className="pl-8" />
          </div>
          {add}
        </div>
      </div>

      {!shown.length ? (
        <Empty title="Nothing matches">Try another vertical, a theme or part of the title.</Empty>
      ) : view === "library" ? (
        <LibraryList pieces={shown} byId={byId} sequences={sequences} allVerticals={verticals} />
      ) : view === "sequences" ? (
        <SequenceBuilder pieces={shown} all={pieces} byId={byId} clientSlug={clientSlug} canEdit={canEdit} aiEnabled={aiEnabled} approval={approval && canEdit ? { ...approval, allVerticals: verticals } : null} />
      ) : (
        <Matrix pieces={shown} byId={byId} sequences={sequences} allVerticals={verticals} selected={selected} onSelect={setSelected} />
      )}
    </div>
  )
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface px-6 py-10 text-center">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

// ── Library ────────────────────────────────────────────────────────────────

const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")

function seqState(p: LibraryPiece): { rag: Rag; label: string } {
  if (p.seqStatus === "approved") return { rag: "green", label: "Approved" }
  if (p.seqStatus === "not_required") return { rag: "na", label: "Not required" }
  return { rag: "amber", label: p.reapproval ? "Changed since approval" : "Awaiting approval" }
}

function Verticals({ list, all }: { list: string[]; all: string[] }) {
  if (all.length && all.every((v) => list.includes(v))) return <span className="pill">All verticals</span>
  return (
    <>
      {list.map((v) => (
        <span key={v} className="pill">
          {v}
        </span>
      ))}
    </>
  )
}

function LibraryList({ pieces, byId, sequences, allVerticals }: { pieces: LibraryPiece[]; byId: Map<string, LibraryPiece>; sequences: Sequences; allVerticals: string[] }) {
  const rows = [...pieces].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.code.localeCompare(b.code, undefined, { numeric: true }))
  return (
    <div className="space-y-2">
      <ul className="surface divide-y overflow-hidden">
        <li className="hidden grid-cols-[minmax(0,1fr)_8rem_7.5rem_7rem_5.5rem_11rem] gap-4 px-4 py-2 text-xs text-muted-foreground lg:grid" aria-hidden>
          <span>Content</span>
          <span>Type</span>
          <span>Stage</span>
          <span>Written for</span>
          <span>Sent by</span>
          <span>Sequence</span>
        </li>
        {rows.map((p) => {
          const sent = timesSent(p.id, sequences)
          const state = seqState(p)
          return (
            <li key={p.id}>
              <details className="group">
                <summary className="cursor-pointer list-none px-4 py-3 hover:bg-white/[0.03] [&::-webkit-details-marker]:hidden">
                  <div className="grid gap-x-4 gap-y-1.5 lg:grid-cols-[minmax(0,1fr)_8rem_7.5rem_7rem_5.5rem_11rem] lg:items-center">
                    <div className="flex min-w-0 items-start gap-2">
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
                      <div className="min-w-0">
                        <p className="font-medium leading-snug">{p.title}</p>
                        {p.theme && <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.theme}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-sm text-muted-foreground lg:contents lg:pl-0">
                      <span>{p.type}</span>
                      <span>{p.stage}</span>
                      <span>{p.audiences.join(", ")}</span>
                      <span className={cn("tabular-nums", sent === 0 && "text-rag-amber")} title="How many other pieces send this one as a follow-up email">
                        {sent === 0 ? "None" : `${sent} sequence${sent === 1 ? "" : "s"}`}
                      </span>
                      <span className="inline-flex items-center gap-2 text-foreground">
                        <StatusDot status={state.rag} />
                        <span className="text-sm">{state.label}</span>
                      </span>
                    </div>
                  </div>
                </summary>
                <PieceDetail p={p} byId={byId} allVerticals={allVerticals} />
              </details>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">&ldquo;Sent by&rdquo; counts how many other pieces send this one as a follow-up email. Pieces at none aren&apos;t being cross-promoted.</p>
    </div>
  )
}

function emailTarget(e: LibraryEmail, byId: Map<string, LibraryPiece>) {
  if (e.handoff) return { label: "Sales handoff", url: null, missing: false }
  if (!e.targetId) return { label: "Not set", url: null, missing: true }
  const t = byId.get(e.targetId)
  return t ? { label: t.title, url: t.url, missing: false } : { label: "Removed content", url: null, missing: true }
}

function PieceDetail({ p, byId, allVerticals }: { p: LibraryPiece; byId: Map<string, LibraryPiece>; allVerticals: string[] }) {
  return (
    <div className="grid gap-6 border-t bg-background/40 px-4 py-4 pl-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-3 text-sm">
        {p.purpose && <p className="prose-body">{p.purpose}</p>}
        <div className="flex flex-wrap gap-1.5">
          <Verticals list={p.verticals} all={allVerticals} />
        </div>
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Code</dt>
          <dd>{p.code}</dd>
          <dt className="text-muted-foreground">Added</dt>
          <dd>{longDate(p.createdAt)}</dd>
          {p.approvedAt && (
            <>
              <dt className="text-muted-foreground">Approved</dt>
              <dd>{longDate(p.approvedAt)}</dd>
            </>
          )}
        </dl>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {p.url && (
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {host(p.url)} <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          {p.notionPageUrl && (
            <a href={p.notionPageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Brief in Notion <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-[13px] font-semibold text-foreground">Its follow-up sequence</h4>
        <ol className="space-y-3">
          {p.emails.map((e) => {
            const t = emailTarget(e, byId)
            return (
              <li key={e.slot} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3 text-sm">
                <span className="pt-px text-xs text-muted-foreground">Email {e.slot}</span>
                <div className="min-w-0">
                  <p className={cn("font-medium", t.missing && "text-muted-foreground")}>
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {t.label}
                      </a>
                    ) : (
                      t.label
                    )}
                    {e.claudesPick && <span className="pill ml-2 align-middle">Claude&apos;s pick</span>}
                  </p>
                  {e.angle && <p className="prose-body mt-0.5 text-xs">{e.angle}</p>}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

// ── Matrix ─────────────────────────────────────────────────────────────────

const DOT: Record<FitLevel, string> = { 3: "bg-lime", 2: "bg-lime/55", 1: "bg-lime/20 ring-1 ring-lime/40", 0: "bg-border" }

function FitDot({ level }: { level: FitLevel }) {
  return <span aria-hidden className={cn("inline-block size-2.5 rounded-full", DOT[level])} />
}

function Matrix({
  pieces,
  byId,
  sequences,
  allVerticals,
  selected,
  onSelect,
}: {
  pieces: LibraryPiece[]
  byId: Map<string, LibraryPiece>
  sequences: Sequences
  allVerticals: string[]
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const number = new Map(pieces.map((p, i) => [p.id, i + 1]))
  const sel = selected && number.has(selected) ? byId.get(selected)! : null
  const ranked = sel ? bestPairings(sel, pieces, sequences, allVerticals) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {([3, 2, 1] as const).map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <FitDot level={l} />
            {FIT_LABEL[l]}
          </span>
        ))}
        <span>Rows are the piece someone engaged with; columns are what to promote next.</span>
      </div>

      <div className="surface p-4" aria-live="polite">
        {sel ? (
          <>
            <p className="font-semibold">Promotes well alongside {sel.title}</p>
            {ranked.length ? (
              <ol className="mt-3 space-y-2.5">
                {ranked.map((r) => (
                  <li key={r.piece.id} className="flex gap-3 text-sm">
                    <span className="pt-1.5">
                      <FitDot level={r.level} />
                    </span>
                    <div className="min-w-0">
                      {byId.get(r.piece.id)?.url ? (
                        <a href={byId.get(r.piece.id)!.url!} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                          {r.piece.title}
                        </a>
                      ) : (
                        <span className="font-medium">{r.piece.title}</span>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {FIT_LABEL[r.level]}. {r.reasons.filter((x) => x !== "No vertical in common").join(". ")}.
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Nothing in this view is a real fit. Try All verticals.</p>
            )}
          </>
        ) : (
          <>
            <p className="font-semibold">Pick a piece to see what promotes well with it</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Click any title, or any dot, for the strongest pairings and why.</p>
          </>
        )}
      </div>

      <div className="surface overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th scope="col" className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-normal text-muted-foreground">
                Engaged with
              </th>
              {pieces.map((b) => (
                <th key={b.id} scope="col" title={b.title} className="w-9 px-1 py-2 text-center text-xs font-normal text-muted-foreground tabular-nums">
                  {number.get(b.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pieces.map((a) => {
              const isSel = a.id === selected
              return (
                <tr key={a.id} className={cn("border-b last:border-b-0", isSel && "bg-secondary/60")}>
                  <th scope="row" className={cn("sticky left-0 z-10 max-w-72 min-w-56 px-1 py-0.5 text-left font-normal", isSel ? "bg-secondary" : "bg-card")}>
                    <button
                      type="button"
                      aria-pressed={isSel}
                      onClick={() => onSelect(isSel ? null : a.id)}
                      className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{number.get(a.id)}</span>
                      <span className="line-clamp-2">{a.title}</span>
                    </button>
                  </th>
                  {pieces.map((b) => {
                    if (a.id === b.id)
                      return (
                        <td key={b.id} className="text-center text-xs text-muted-foreground" aria-label="Same piece">
                          –
                        </td>
                      )
                    const fit = pairFit(a, b, sequences, allVerticals)
                    const why = `${number.get(b.id)}. ${b.title}\n${FIT_LABEL[fit.level]}: ${fit.reasons.join("; ")}`
                    return (
                      <td key={b.id} className="p-0 text-center">
                        <button type="button" title={why} aria-label={`${a.title} to ${b.title}: ${FIT_LABEL[fit.level]}`} onClick={() => onSelect(a.id)} className="inline-flex size-8 items-center justify-center rounded-md outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
                          <FitDot level={fit.level} />
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Fit comes from each piece&apos;s theme, verticals, audience and funnel stage, plus the sequences already set up. It updates as content and sequences change. Hover a dot to see why.
      </p>
    </div>
  )
}
