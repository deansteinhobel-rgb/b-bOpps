"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { isBriefUpdate, sequenceBriefText, sequenceBriefTitle } from "@/lib/content-library/brief"
import type { LibraryPiece } from "@/lib/content-library/load"
import { approveSequence } from "./actions"

/** Who can lead the brief (Notion users on the client's team list, the team first) and whether writes are live. */
export type ApprovalSetup = { leads: { notionUserId: string; name: string; onTeam: boolean }[]; defaultLead: string | null; live: boolean; allVerticals: string[] }

const field = "h-9 w-full min-w-0 rounded-lg border border-input bg-input/30 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

/** "Approve sequence": pick the Project Lead and due date, see exactly what goes to Notion, send. */
export function ApproveDialog({ p, byId, clientSlug, setup, disabled }: { p: LibraryPiece; byId: Map<string, LibraryPiece>; clientSlug: string; setup: ApprovalSetup; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [lead, setLead] = useState(setup.defaultLead ?? setup.leads[0]?.notionUserId ?? "")
  const [due, setDue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const update = isBriefUpdate(p)
  const set = p.emails.some((e) => e.targetId || e.handoff)
  const libraryUrl = typeof window === "undefined" ? "" : `${window.location.origin}/clients/${clientSlug}/library?view=sequences`

  const approve = () =>
    start(async () => {
      setError(null)
      const r = await approveSequence({ clientSlug, pieceId: p.id, ownerNotionId: lead, dueDate: due || null })
      if (!r.ok) return void setError(r.message)
      toast.success(r.message ?? "Approved")
      setOpen(false)
    })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" disabled={disabled || !set} title={set ? undefined : "Set at least one email first"} />}>{update ? "Approve update" : "Approve sequence"}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{update ? "Approve the updated sequence" : "Approve the sequence"}</DialogTitle>
          <DialogDescription>
            This creates one {update ? "update brief" : "brief"} on Master Production for the copywriter: Production Type Email, Status Content Ready for Copy, proofing and automation pending.
            {!setup.live && " Test mode is on, so it's logged and nothing is sent to Notion."}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-rag-red">{error}</p>}
        {setup.leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody on this client&apos;s team list is linked to a Notion user yet, so the brief has no one to lead it. An admin can link people in Admin → People.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Project Lead
              <select value={lead} onChange={(e) => setLead(e.target.value)} className={field}>
                {setup.leads.map((l) => (
                  <option key={l.notionUserId} value={l.notionUserId}>
                    {l.name}
                    {l.onTeam ? "" : " (not on the team)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Due date (optional)
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
        )}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">What goes to Notion</p>
          <div className="rounded-lg border bg-background/50 p-3">
            <p className="text-sm font-medium">{sequenceBriefTitle(p)}</p>
            <pre className="mt-2 max-h-64 overflow-y-auto font-sans text-xs whitespace-pre-wrap text-body">{sequenceBriefText(p, byId, { allVerticals: setup.allVerticals, libraryUrl })}</pre>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={approve} disabled={pending || !lead}>
            {pending ? "Approving…" : setup.live ? "Approve and send brief" : "Approve (test mode)"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
