"use client"

import { ClaudeMark } from "@/components/brand"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Segmented } from "@/components/segmented"
import { StatusDot, type Rag } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import type { LibraryEmail, LibraryPiece, SeqStatus } from "@/lib/content-library/load"
import { longDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { revertToClaude, setAngle, setEmail, setNotRequired } from "./actions"
import { ApproveDialog, type ApprovalSetup } from "./approve-dialog"
import { askAgain, rewriteAngle } from "./claude-api"

type Filter = "" | SeqStatus

function approvalState(p: LibraryPiece): { rag: Rag; label: string } {
  if (p.seqStatus === "approved") return { rag: "green", label: `Approved${p.approvedAt ? ` ${longDate(p.approvedAt)}` : ""}` }
  if (p.seqStatus === "not_required") return { rag: "na", label: "Not required" }
  return { rag: "amber", label: p.reapproval ? "Changed since approval" : "Awaiting approval" }
}

type Run = (fn: () => Promise<{ ok: boolean; message?: string }>) => void

/** Sequence builder: what to send someone who engaged with each piece, and the angle for each email. */
export function SequenceBuilder({ pieces, all, byId, clientSlug, canEdit, aiEnabled, approval }: { pieces: LibraryPiece[]; all: LibraryPiece[]; byId: Map<string, LibraryPiece>; clientSlug: string; canEdit: boolean; aiEnabled: boolean; approval: ApprovalSetup | null }) {
  const [filter, setFilter] = useState<Filter>("")
  const count = (s: SeqStatus) => pieces.filter((p) => p.seqStatus === s).length
  const rows = pieces.filter((p) => !filter || p.seqStatus === filter)

  return (
    <div className="space-y-3">
      <Segmented
        label="Filter by approval"
        tone="quiet"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "", label: "All", count: pieces.length },
          { value: "pending", label: "Awaiting approval", count: count("pending") },
          { value: "approved", label: "Approved", count: count("approved") },
          { value: "not_required", label: "Not required", count: count("not_required") },
        ]}
      />
      {!rows.length ? (
        <div className="surface px-6 py-10 text-center text-sm text-muted-foreground">{filter === "pending" ? "No sequences are waiting for approval." : "Nothing here. Try another filter, vertical or search."}</div>
      ) : (
        <ul className="surface divide-y">
          {rows.map((p) => (
            <SequenceRow key={p.id} p={p} all={all} byId={byId} clientSlug={clientSlug} canEdit={canEdit} aiEnabled={aiEnabled} approval={approval} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Change any email with its menu. Picking Claude&apos;s choice again brings back its angle; picking something else has Claude write a new one (or clears it for you to write). Angles save when you click away. Every change is live for the whole team, and changing an approved sequence sends it back for approval.
      </p>
    </div>
  )
}

function SequenceRow({ p, all, byId, clientSlug, canEdit, aiEnabled, approval }: { p: LibraryPiece; all: LibraryPiece[]; byId: Map<string, LibraryPiece>; clientSlug: string; canEdit: boolean; aiEnabled: boolean; approval: ApprovalSetup | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [asking, setAsking] = useState(false)
  const [writing, setWriting] = useState<Partial<Record<1 | 2 | 3, boolean>>>({})
  const run: Run = (fn) =>
    start(async () => {
      const r = await fn()
      if (r.ok) {
        if (r.message) toast.success(r.message)
      } else toast.error(r.message ?? "Something went wrong.")
    })

  /** Claude writes the angle for what an email sends now (after a new pick, or "Rewrite"). */
  const writeAngle = async (slot: 1 | 2 | 3) => {
    setWriting((w) => ({ ...w, [slot]: true }))
    try {
      await rewriteAngle(clientSlug, p.id, slot)
      router.refresh()
    } catch (e) {
      toast.error(`${(e as Error).message} You can write the angle yourself.`)
    } finally {
      setWriting((w) => ({ ...w, [slot]: false }))
    }
  }

  const choose = (slot: 1 | 2 | 3, target: string | null) =>
    run(async () => {
      const r = await setEmail({ clientSlug, pieceId: p.id, slot, target })
      if (r.ok && r.needsAngle && aiEnabled) void writeAngle(slot)
      return r
    })

  const reask = async () => {
    setAsking(true)
    try {
      const r = await askAgain(clientSlug, p.id)
      toast.success(r.kept ? `Claude's picks refreshed. Your ${r.kept} edit${r.kept === 1 ? " was" : "s were"} kept` : r.changed ? "Sequence refreshed with Claude's new picks" : "Claude stands by its picks")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAsking(false)
    }
  }
  const set = p.emails.filter((e) => e.targetId || e.handoff).length
  const state = approvalState(p)

  return (
    <li className={cn("grid gap-4 px-4 py-4 lg:grid-cols-[15rem_repeat(3,minmax(0,1fr))]", pending && "opacity-70")} aria-busy={pending}>
      <div className="min-w-0 space-y-2">
        <div>
          <p className="eyebrow">If they engaged with</p>
          <p className="font-medium leading-snug">{p.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{[p.theme, p.audiences.join(", ")].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-1.5" aria-label={`${set} of 3 emails set`}>
          {[1, 2, 3].map((i) => (
            <span key={i} aria-hidden className={cn("h-1 w-5 rounded-full", i <= set ? "bg-lime" : "bg-border")} />
          ))}
          <span className="ml-1 text-xs text-muted-foreground">{set === 3 ? "Complete" : `${set} of 3 set`}</span>
        </div>
        {canEdit && aiEnabled && (
          <button type="button" disabled={asking || pending} onClick={() => void reask()} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-70">
            <ClaudeMark className="size-3 text-lime" />
            {asking ? "Asking Claude…" : "Ask Claude again"}
          </button>
        )}
        <p className="inline-flex items-center gap-2 text-sm">
          <StatusDot status={state.rag} />
          {state.label}
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {p.seqStatus !== "approved" && approval && <ApproveDialog p={p} byId={byId} clientSlug={clientSlug} setup={approval} disabled={pending || asking} />}
            {p.seqStatus === "pending" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setNotRequired({ clientSlug, pieceId: p.id, notRequired: true }))}>
                Not required
              </Button>
            )}
            {p.seqStatus === "not_required" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setNotRequired({ clientSlug, pieceId: p.id, notRequired: false }))}>
                Needs a sequence
              </Button>
            )}
          </div>
        )}
        {p.notionPageUrl && (
          <a href={p.notionPageUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-muted-foreground hover:text-foreground">
            Brief in Notion ↗
          </a>
        )}
      </div>
      {p.emails.map((e) => (
        <EmailSlot
          key={e.slot}
          p={p}
          e={e}
          all={all}
          byId={byId}
          clientSlug={clientSlug}
          canEdit={canEdit}
          pending={pending || asking}
          run={run}
          writing={Boolean(writing[e.slot])}
          onChoose={(t) => choose(e.slot, t)}
          onRewrite={canEdit && aiEnabled ? () => void writeAngle(e.slot) : null}
        />
      ))}
    </li>
  )
}

const valueOf = (e: Pick<LibraryEmail, "targetId" | "handoff">) => (e.handoff ? "handoff" : (e.targetId ?? ""))
const titleOf = (v: { targetId: string | null; handoff: boolean }, byId: Map<string, LibraryPiece>) => (v.handoff ? "the sales handoff" : v.targetId ? (byId.get(v.targetId)?.title ?? "removed content") : "nothing")

function EmailSlot({
  p,
  e,
  all,
  byId,
  clientSlug,
  canEdit,
  pending,
  run,
  writing,
  onChoose,
  onRewrite,
}: {
  p: LibraryPiece
  e: LibraryEmail
  all: LibraryPiece[]
  byId: Map<string, LibraryPiece>
  clientSlug: string
  canEdit: boolean
  pending: boolean
  run: Run
  writing: boolean
  onChoose: (target: string | null) => void
  onRewrite: (() => void) | null
}) {
  const value = valueOf(e)
  const removed = Boolean(e.targetId && !byId.has(e.targetId))
  const edited = e.suggested && !e.claudesPick
  const samePiece = e.suggested && valueOf(e.suggested) === value

  return (
    <div className="min-w-0 space-y-1.5">
      <label className="eyebrow block" htmlFor={`email-${p.id}-${e.slot}`}>
        {e.slot === 1 ? "Send email 1" : `Then email ${e.slot}`}
      </label>
      <select
        id={`email-${p.id}-${e.slot}`}
        value={value}
        disabled={!canEdit || pending || writing}
        onChange={(ev) => onChoose(ev.target.value || null)}
        className={cn(
          "h-9 w-full min-w-0 truncate rounded-lg border border-input bg-input/30 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-80",
          !value && "text-muted-foreground",
        )}
      >
        <option value="">Not set</option>
        {all
          .filter((x) => x.id !== p.id)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        {(e.slot === 3 || e.handoff) && <option value="handoff">Sales handoff</option>}
        {removed && <option value={e.targetId!}>Removed content</option>}
      </select>
      <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        {e.claudesPick && <span className="pill">Claude&apos;s pick</span>}
        {edited && (
          <>
            <span className="text-rag-amber">{samePiece ? "Angle edited" : "Edited"}</span>
            {!samePiece && <span className="text-muted-foreground">Claude picked {titleOf(e.suggested!, byId)}</span>}
            {canEdit && (
              <button type="button" disabled={pending} onClick={() => run(() => revertToClaude({ clientSlug, pieceId: p.id, slot: e.slot }))} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Revert
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Email angle</span>
        {onRewrite && value && (
          <button type="button" disabled={writing || pending} onClick={onRewrite} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-70">
            {writing ? "Writing…" : "Rewrite"}
          </button>
        )}
      </div>
      <textarea
        key={`${e.targetId}-${e.handoff}-${e.angle}-${writing}`}
        defaultValue={writing ? "" : (e.angle ?? "")}
        readOnly={!canEdit || writing}
        rows={3}
        maxLength={300}
        aria-label={`Email angle for email ${e.slot}`}
        aria-busy={writing}
        placeholder={writing ? "Claude is writing the angle…" : canEdit ? "The hook that connects what they read to this email" : ""}
        onBlur={(ev) => {
          const next = ev.target.value.replace(/\s+/g, " ").trim()
          if (next !== (e.angle ?? "")) run(() => setAngle({ clientSlug, pieceId: p.id, slot: e.slot, angle: next }))
        }}
        className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
    </div>
  )
}
