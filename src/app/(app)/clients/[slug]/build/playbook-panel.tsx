"use client"

import { ChevronRight, Plus } from "lucide-react"
import { useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { describeCheck, GUARD_FIELDS, type CheckRule, type GuardField, type PlaybookRule, type RuleKind } from "@/lib/campaign-builder/guardrails"
import type { NamingConvention } from "@/lib/campaign-builder/naming"
import type { Playbook } from "@/lib/campaign-builder/playbook"
import { shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { addRule, removeRule, researchNow } from "./actions"

const KIND_LABEL: Record<RuleKind, string> = { guardrail: "Guardrails", practice: "House practices", naming: "Naming" }
const STRENGTH: Record<string, string> = { official: "LinkedIn says", consensus: "Agreed", practitioner: "Practitioners" }

/**
 * The LinkedIn playbook under the builder: the team's rules (edited here, for this client or, for
 * admins, every client), the naming convention read from live campaigns, and this month's research.
 */
export function PlaybookPanel(p: { slug: string; rules: PlaybookRule[]; playbook: Playbook | null; naming: NamingConvention | null; canEdit: boolean; isAdmin: boolean }) {
  const [researchMsg, setResearchMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl">LinkedIn playbook</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">What every plan follows: the team&apos;s rules, the client&apos;s naming, and best practice researched each month.</p>
      </div>

      <div className="surface divide-y">
        {(["guardrail", "practice", "naming"] as const).map((kind) => (
          <RuleGroup key={kind} kind={kind} slug={p.slug} rules={p.rules.filter((r) => r.kind === kind)} canEdit={p.canEdit} isAdmin={p.isAdmin} />
        ))}

        <details className="group px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
            Naming read from live campaigns
            {p.naming && <span className="text-xs font-normal text-muted-foreground">· {shortDate(p.naming.createdAt.slice(0, 10))}</span>}
          </summary>
          {p.naming ? (
            <div className="mt-2 space-y-1.5 text-[13px]">
              <code className="block rounded bg-elevated px-2 py-1.5 text-xs text-foreground">{p.naming.pattern}</code>
              <ul className="space-y-0.5 text-body">
                {p.naming.parts.map((x) => (
                  <li key={x.key}>
                    <span className="text-foreground">{`{${x.key}}`}</span> {x.meaning}
                    {x.values.length > 0 && <span className="text-muted-foreground"> · {x.values.slice(0, 5).join(", ")}</span>}
                  </li>
                ))}
              </ul>
              {p.naming.notes && <p className="text-xs text-muted-foreground">{p.naming.notes}</p>}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">Read the first time Claude plans a campaign for this client.</p>
          )}
        </details>

        <details className="group px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
            This month&apos;s research
            {p.playbook && <span className="text-xs font-normal text-muted-foreground">· {shortDate((p.playbook.completedAt ?? p.playbook.period).slice(0, 10))}, {p.playbook.sources.length} sources</span>}
          </summary>
          <div className="mt-2 space-y-4">
            {p.playbook ? (
              <>
                <p className="prose-body text-[13px]">{p.playbook.summary}</p>
                {p.playbook.sections.map((s) => (
                  <div key={s.heading}>
                    <h4 className="text-[13px] font-semibold">{s.heading}</h4>
                    <ul className="mt-1 space-y-1.5">
                      {s.points.map((pt, i) => (
                        <li key={i} className="flex gap-2 text-[13px]">
                          <span className={cn("pill shrink-0", pt.strength === "official" && "text-foreground")}>{STRENGTH[pt.strength]}</span>
                          <span className="prose-body">
                            {pt.text}{" "}
                            {pt.sources.map((n) => {
                              const src = p.playbook!.sources.find((x) => x.n === n)
                              return src ? (
                                <a key={n} href={src.url} target="_blank" rel="noreferrer noopener" className="text-xs text-muted-foreground underline-offset-2 hover:underline" title={src.title}>
                                  [{n}]
                                </a>
                              ) : null
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">No research yet. It runs on the 1st of every month (LinkedIn), the 2nd (Google Ads), 3rd (Meta) and 4th (Reddit).</p>
            )}
            {p.isAdmin && (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await researchNow(p.slug, "linkedin")
                      setResearchMsg(r.ok ? "Researching in the background: a few minutes. Reload to see it." : (r.error ?? "Couldn't start."))
                    })
                  }
                >
                  Research now
                </Button>
                {researchMsg && <span className="text-xs text-muted-foreground">{researchMsg}</span>}
              </div>
            )}
          </div>
        </details>
      </div>
    </section>
  )
}

function RuleGroup({ kind, slug, rules, canEdit, isAdmin }: { kind: RuleKind; slug: string; rules: PlaybookRule[]; canEdit: boolean; isAdmin: boolean }) {
  const [adding, setAdding] = useState(false)
  const [pending, start] = useTransition()
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {KIND_LABEL[kind]}
          <Hint>
            {kind === "guardrail"
              ? "Hard rules. The app checks the ones with a check on every save, dry run and send, and refuses a plan that breaks them."
              : kind === "practice"
                ? "How B&B likes campaigns built. Claude follows them and says which it used."
                : "How to name groups, campaigns and ads. These win over the naming read from live campaigns."}
          </Hint>
        </h3>
        {canEdit && !adding && (
          <button type="button" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden /> Add
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {rules.map((r) => (
          <li key={r.id} className="group flex items-start gap-2 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="text-foreground">{r.title}</span>
              {r.body && <span className="text-body"> · {r.body}</span>}
              <span className="ml-1.5 text-xs text-muted-foreground">
                {r.check_rule ? `${describeCheck(r.check_rule)} · ` : ""}
                {r.client_id ? "this client" : "every client"}
                {r.modes.length === 1 ? ` · ${r.modes[0] === "abx" ? "ABX" : "General"} only` : ""}
              </span>
            </span>
            {canEdit && (r.client_id || isAdmin) && (
              <button
                type="button"
                className="text-xs text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                disabled={pending}
                onClick={() => start(async () => void (await removeRule(slug, r.id)))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {!rules.length && !adding && <li className="text-[13px] text-muted-foreground">None yet.</li>}
      </ul>
      {adding && <AddRule kind={kind} slug={slug} isAdmin={isAdmin} onDone={() => setAdding(false)} />}
    </div>
  )
}

function AddRule({ kind, slug, isAdmin, onDone }: { kind: RuleKind; slug: string; isAdmin: boolean; onDone: () => void }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [scope, setScope] = useState<"client" | "all">("client")
  const [modes, setModes] = useState<"both" | "general" | "abx">("both")
  const [field, setField] = useState<GuardField | "">("")
  const [op, setOp] = useState<CheckRule["op"]>("max")
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const save = () =>
    start(async () => {
      const numeric = ["dailyBudget", "bid", "ads", "headlineLength", "introLength"].includes(field)
      const r = await addRule(slug, {
        kind,
        title,
        body,
        allClients: scope === "all",
        modes: modes === "both" ? ["general", "abx"] : [modes],
        check: kind === "guardrail" && field ? { field, op, ...(value ? { value: numeric ? Number(value) : value } : {}) } : null,
      })
      if (r.ok) onDone()
      else setError(r.error ?? "Couldn't add it.")
    })
  return (
    <div className="mt-3 space-y-3 rounded-md border p-3">
      <Input aria-label="Rule" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "naming" ? "e.g. Campaign groups start with the sprint number" : kind === "guardrail" ? "e.g. No more than $150 a day on a new campaign" : "e.g. Exclude current customers on every cold campaign"} />
      <Textarea aria-label="Details" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Why, and any detail Claude needs (optional)" />
      {kind === "guardrail" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="r-field">The app checks</Label>
            <select id="r-field" className={fieldClass} value={field} onChange={(e) => setField(e.target.value as GuardField)}>
              <option value="">Nothing (Claude follows it)</option>
              {(Object.keys(GUARD_FIELDS) as GuardField[]).map((f) => (
                <option key={f} value={f}>
                  {GUARD_FIELDS[f]}
                </option>
              ))}
            </select>
          </div>
          {field && (
            <>
              <div className="space-y-1">
                <Label htmlFor="r-op">Rule</Label>
                <select id="r-op" className={fieldClass} value={op} onChange={(e) => setOp(e.target.value as CheckRule["op"])}>
                  <option value="max">At most</option>
                  <option value="min">At least</option>
                  <option value="forbid">Never</option>
                  <option value="require">Always</option>
                </select>
              </div>
              {field !== "audienceNetwork" && (
                <div className="space-y-1">
                  <Label htmlFor="r-value">Value</Label>
                  <Input id="r-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={field === "objective" ? "LEAD_GENERATION" : field === "facet" ? "staffCountRanges" : "150"} />
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Applies to" className={cn(fieldClass, "w-auto")} value={scope} onChange={(e) => setScope(e.target.value as "client" | "all")}>
          <option value="client">This client</option>
          {isAdmin && <option value="all">Every client</option>}
        </select>
        <select aria-label="Views" className={cn(fieldClass, "w-auto")} value={modes} onChange={(e) => setModes(e.target.value as "both" | "general" | "abx")}>
          <option value="both">General and ABX</option>
          <option value="general">General only</option>
          <option value="abx">ABX only</option>
        </select>
        <span className="flex-1 text-xs text-rag-red">{error}</span>
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={pending || !title.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}
