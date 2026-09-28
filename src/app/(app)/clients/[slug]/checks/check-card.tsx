"use client"

import { useState, useTransition } from "react"
import { ActionForm, type OwnerOption } from "@/components/action-form"
import { Sparkle } from "@/components/fx/sparkle"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AutoData } from "@/lib/checks/auto-data"
import type { CheckDefinition, CheckResult } from "@/lib/checks/runs"
import type { PreviewMap } from "@/lib/previews"
import { cn } from "@/lib/utils"
import { AutoDataView } from "./auto-data-view"
import { saveCheckResult } from "./actions"

type Status = "green" | "amber" | "red" | "na"
const STATUSES: { value: Status; label: string; className: string }[] = [
  { value: "green", label: "Green", className: "data-[on=true]:border-rag-green data-[on=true]:bg-rag-green-bg data-[on=true]:text-rag-green" },
  { value: "amber", label: "Amber", className: "data-[on=true]:border-rag-amber data-[on=true]:bg-rag-amber-bg data-[on=true]:text-rag-amber" },
  { value: "red", label: "Red", className: "data-[on=true]:border-rag-red data-[on=true]:bg-rag-red-bg data-[on=true]:text-rag-red" },
  { value: "na", label: "N/A", className: "data-[on=true]:border-rag-na data-[on=true]:bg-rag-na-bg data-[on=true]:text-rag-na" },
]
const DOT: Record<Status, string> = { green: "bg-rag-green", amber: "bg-rag-amber", red: "bg-rag-red", na: "bg-rag-na" }
const OWNER: Record<CheckDefinition["owner_role"], string> = { specialist: "Paid media specialist", am: "Account manager", gtm_lead: "GTM lead" }

export type Person = { id: string; name: string; onTeam: boolean }

export function CheckCard(props: {
  definition: CheckDefinition
  result: CheckResult
  liveData: AutoData | null
  people: Person[]
  checkedByName: string | null
  flaggedToName: string | null
  /** Worked out on the server: red, no Notion action, checked more than 24 hours ago. */
  redNotActioned: boolean
  previews: PreviewMap
  /** Called after a successful save (the deck uses it to bring the next check forward). */
  onSaved?: () => void
  /** Extra controls shown next to Save (e.g. "Skip for now" in the deck). */
  extraActions?: React.ReactNode
  /** For "Create action in Notion" on reds. */
  action: { clientSlug: string; live: boolean; owners: OwnerOption[]; defaultOwnerNotionId: string | null; defaultDue: string; notionUrl: string | null }
}) {
  const { definition: d, result: r } = props
  const [status, setStatus] = useState<Status | null>(r.status)
  const [findings, setFindings] = useState(r.findings ?? "")
  const [flaggedTo, setFlaggedTo] = useState<string>(r.flagged_to_profile_id ?? "")
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const [actionOpen, setActionOpen] = useState(false)

  const dirty = status !== r.status || findings !== (r.findings ?? "") || flaggedTo !== (r.flagged_to_profile_id ?? "")
  const savedData = r.auto_data as AutoData | null

  const save = () =>
    start(async () => {
      if (!status) return setMessage({ ok: false, text: "Pick a status before saving." })
      const res = await saveCheckResult({ resultId: r.id, status, findings, flaggedTo: flaggedTo || null })
      setMessage(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.message ?? "Couldn't save." })
      if (res.ok) props.onSaved?.()
    })

  return (
    <article id={`check-${r.id}`} className={cn("scroll-mt-6 rounded-xl border bg-card p-5 shadow-[0_1px_0_0_rgb(255_255_255/0.04)_inset]", r.status === "red" && "border-rag-red/40")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl">{d.name}</h3>
          <p className="text-xs text-muted-foreground">
            {OWNER[d.owner_role]}
            {props.checkedByName && r.checked_at && ` · checked by ${props.checkedByName}, ${new Date(r.checked_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`}
          </p>
        </div>
        <div className="flex gap-2">
          {props.redNotActioned && <StatusBadge status="red" label="Red not actioned" />}
          {r.status ? <StatusBadge status={r.status} /> : <span className="text-xs text-muted-foreground">Not done</span>}
        </div>
      </header>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Instructions</summary>
        <dl className="mt-2 space-y-2">
          {(
            [
              ["What to do", d.instructions],
              ["What to record", d.what_to_record],
              ["Not applicable when", d.not_applicable_when],
              ["Flag immediately when", d.flag_immediately_when],
              ["Status guide", d.guide],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="eyebrow">{k}</dt>
                <dd className="whitespace-pre-line">{v}</dd>
              </div>
            ))}
        </dl>
      </details>

      <div className="mt-3">
        {r.status && savedData ? (
          <AutoDataView data={savedData} label="Numbers when checked" previews={props.previews} />
        ) : props.liveData ? (
          <AutoDataView data={props.liveData} label="Pre-loaded" previews={props.previews} />
        ) : d.pre_loaded ? (
          <p className="text-xs text-muted-foreground">No pre-loaded numbers for this check. Look it up in the platform.</p>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        <fieldset>
          <legend className="mb-1 text-sm">Status</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={status === s.value}
                aria-label={s.label}
                title={s.label}
                data-on={status === s.value}
                onClick={() => setStatus(s.value)}
                className={cn("flex h-9 min-w-9 items-center justify-center rounded-full border px-3 text-sm transition-colors hover:bg-accent", s.className)}
              >
                {s.value === "na" ? "N/A" : <span aria-hidden className={cn("size-3 rounded-full", DOT[s.value])} />}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1">
          <Label htmlFor={`findings-${r.id}`}>Findings</Label>
          <Textarea id={`findings-${r.id}`} value={findings} onChange={(e) => setFindings(e.target.value)} rows={3} placeholder={d.what_to_record ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`flag-${r.id}`}>Flag to</Label>
          <select
            id={`flag-${r.id}`}
            value={flaggedTo}
            onChange={(e) => setFlaggedTo(e.target.value)}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="">No one</option>
            {props.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.onTeam ? "" : " (not on this client)"}
              </option>
            ))}
          </select>
          {props.flaggedToName && r.flagged_at && (
            <p className="text-xs text-muted-foreground">
              Flagged to {props.flaggedToName} on {new Date(r.flagged_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Sparkle>
            <Button onClick={save} disabled={pending || !dirty}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </Sparkle>
          {props.extraActions}
          {r.status === "red" && !r.notion_action_page_id && (
            <Button variant="outline" onClick={() => setActionOpen((o) => !o)} aria-expanded={actionOpen}>
              {actionOpen ? "Close" : "Create action in Notion"}
            </Button>
          )}
          {r.notion_action_page_id && props.action.notionUrl && (
            <a href={props.action.notionUrl} target="_blank" rel="noreferrer" className="text-sm underline">
              Notion action
            </a>
          )}
          {message && (
            <span className={cn("text-sm", message.ok ? "text-rag-green" : "text-rag-red")} role="status">
              {message.text}
            </span>
          )}
        </div>
        {actionOpen && r.status === "red" && !r.notion_action_page_id && (
          <ActionForm
            clientSlug={props.action.clientSlug}
            live={props.action.live}
            owners={props.action.owners}
            checkResultId={r.id}
            defaults={{
              title: `${d.name}: ${(r.findings ?? "").split("\n")[0].slice(0, 120)}`,
              ownerId: props.action.defaultOwnerNotionId,
              dueDate: props.action.defaultDue,
              description: r.findings ?? "",
            }}
          />
        )}
      </div>
    </article>
  )
}
