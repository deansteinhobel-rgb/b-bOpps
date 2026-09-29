"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { AdThumb } from "@/components/ad-thumb"
import { PlatformIcon } from "@/components/brand"
import { fieldClass } from "@/components/field-class"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { money } from "@/lib/format"
import { RULES, type Category, type FeedInsight, type InsightPlatform, type Severity } from "@/lib/insights/rules"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import type { PreviewMap } from "@/lib/previews"
import { cn } from "@/lib/utils"
import { briefInsight, logInsight, testFromInsight } from "./actions"

type Owner = { id: string | null; name: string; onTeam: boolean }
type View = "open" | "in_hand" | "snoozed" | "closed"

const VIEWS: { key: View; label: string }[] = [
  { key: "open", label: "To do" },
  { key: "in_hand", label: "In hand" },
  { key: "snoozed", label: "Snoozed" },
  { key: "closed", label: "Handled" },
]
const CATEGORY: Record<Category, { label: string; hint: string }> = {
  waste: { label: "Wasted spend", hint: "Money going on things that don't convert" },
  problem: { label: "Problems", hint: "Something broke or got worse" },
  opportunity: { label: "Opportunities", hint: "Something to grow or learn from" },
  audience: { label: "Audiences", hint: "Who to add, exclude or check" },
}
const SEVERITY: Record<Severity, { label: string; dot: string }> = {
  high: { label: "High priority", dot: "bg-rag-red" },
  medium: { label: "Medium priority", dot: "bg-rag-amber" },
  low: { label: "Low priority", dot: "bg-muted-foreground/50" },
}
const PLATFORMS: InsightPlatform[] = ["google_ads", "linkedin", "meta", "ga4"]
const platformName = (p: InsightPlatform) => (p === "ga4" ? "GA4" : PLATFORM_LABEL[p as Platform])

function Ga4Icon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("inline-block size-4 shrink-0", className)} aria-hidden>
      <rect x="15" y="3" width="5" height="18" rx="2.5" fill="#F9AB00" />
      <rect x="9" y="9" width="5" height="12" rx="2.5" fill="#E37400" />
      <circle cx="5.5" cy="18.5" r="2.5" fill="#E37400" />
    </svg>
  )
}
const Icon = ({ platform, className }: { platform: InsightPlatform; className?: string }) =>
  platform === "ga4" ? <Ga4Icon className={className} /> : <PlatformIcon platform={platform} className={className} />

export function InsightFeed(props: {
  slug: string
  clientName: string
  currency: string
  target: number | null
  insights: FeedInsight[]
  dataThrough: string | null
  /** Ad previews by insight key. */
  previews: PreviewMap
  owners: Owner[]
  live: boolean
  defaultDue: string
  sprintNumber: number
  openKey: string | null
}) {
  const initial = props.openKey ? props.insights.find((i) => i.key === props.openKey) : undefined
  const [view, setView] = useState<View>(initial?.state ?? "open")
  const [platform, setPlatform] = useState<InsightPlatform | null>(null)
  const [category, setCategory] = useState<Category | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(props.openKey)

  useEffect(() => {
    if (props.openKey) document.getElementById(`insight-${props.openKey}`)?.scrollIntoView({ block: "center" })
  }, [props.openKey])

  const inView = props.insights.filter((i) => i.state === view)
  const shown = inView.filter((i) => (!platform || i.platform === platform) && (!category || i.category === category))
  const open = props.insights.filter((i) => i.state === "open")
  const counts = (list: FeedInsight[]) => Object.fromEntries((Object.keys(CATEGORY) as Category[]).map((c) => [c, list.filter((i) => i.category === c)])) as Record<Category, FeedInsight[]>
  const byCategory = counts(open)
  const wasted = byCategory.waste.reduce((s, i) => s + openStake(i), 0)
  const platformsHere = PLATFORMS.filter((p) => inView.some((i) => i.platform === p))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl">Optimise now</h2>
          <p className="text-sm text-muted-foreground">
            What to fix or try, from the last 30 days of numbers{props.dataThrough ? ` (data to ${props.dataThrough})` : ""}. Make the change in the platform, then mark it done here.
          </p>
        </div>
      </div>

      {/* Summary: the open queue by category. Clicking one filters the list. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {(Object.keys(CATEGORY) as Category[]).map((c) => {
          const active = category === c
          return (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCategory(active ? null : c)
                setView("open")
              }}
              aria-pressed={active}
              className={cn("bg-card px-4 py-3.5 text-left transition-colors hover:bg-secondary/60", active && "bg-secondary")}
            >
              <span className="text-xs text-muted-foreground">{CATEGORY[c].label}</span>
              <span className="mt-1 block font-heading text-2xl leading-none tabular-nums">{byCategory[c].length}</span>
              <span className="mt-2 block truncate text-xs text-muted-foreground">
                {c === "waste" && wasted > 0 ? `${money(wasted, props.currency)} at stake` : CATEGORY[c].hint}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border bg-card p-1" role="tablist" aria-label="Insight status">
          {VIEWS.map((v) => {
            const n = props.insights.filter((i) => i.state === v.key).length
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                onClick={() => setView(v.key)}
                className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", view === v.key ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {v.label} <span className="ml-1 text-xs tabular-nums text-muted-foreground">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={!platform} onClick={() => setPlatform(null)}>
            All platforms
          </Chip>
          {platformsHere.map((p) => (
            <Chip key={p} active={platform === p} onClick={() => setPlatform(platform === p ? null : p)}>
              <Icon platform={p} className="size-3.5" />
              {platformName(p)}
            </Chip>
          ))}
          {category && (
            <Chip active onClick={() => setCategory(null)}>
              {CATEGORY[category].label} ✕
            </Chip>
          )}
        </div>
      </div>

      <div className="surface divide-y overflow-hidden">
        {shown.map((i) => (
          <InsightRow key={i.key} insight={i} open={openKey === i.key} onToggle={() => setOpenKey(openKey === i.key ? null : i.key)} {...props} />
        ))}
        {shown.length === 0 && (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">
            {view === "open" ? (props.insights.some((i) => i.state === "open") ? "Nothing here with these filters." : "Nothing to optimise right now. Nice.") : "Nothing here."}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Done and Dismiss hide the items you handled; anything new (a new search term, a new week of high costs) brings the insight back. Nothing here changes the ad platforms.
        {props.target === null && " Set a target cost per result for this client to switch on the cost rules."}
      </p>
    </div>
  )
}

/** Something to capitalise on (Dean: marked with a lime border, in brand colours). */
const isOpportunity = (i: FeedInsight) => i.category === "opportunity" || i.rule === "li_strong_segments"

/** Money at stake on the items still open (lists), or on the whole insight. */
function openStake(i: FeedInsight) {
  if (i.atStake === null) return 0 // opportunities: nothing at stake
  if (i.listed && i.open.some((x) => x.spend !== undefined)) return i.open.reduce((s, x) => s + (x.spend ?? 0), 0)
  return i.atStake ?? 0
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", active ? "border-foreground/30 bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  )
}

type RowProps = Parameters<typeof InsightFeed>[0] & { insight: FeedInsight; open: boolean; onToggle: () => void }

function InsightRow({ insight: i, open, onToggle, ...p }: RowProps) {
  const stake = openStake(i)
  const campaignHref = i.campaignId && i.platform !== "ga4" ? `/clients/${p.slug}/performance/${i.platform}/${encodeURIComponent(i.campaignId)}` : null
  return (
    <div id={`insight-${i.key}`} className={cn("border-l-2 border-transparent", isOpportunity(i) && "border-l-lime bg-lime/[0.03]", open && "bg-secondary/25")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-secondary/40">
        <span className={cn("mt-2 size-2 shrink-0 rounded-full", SEVERITY[i.severity].dot)} title={SEVERITY[i.severity].label}>
          <span className="sr-only">{SEVERITY[i.severity].label}</span>
        </span>
        <Icon platform={i.platform} className="mt-0.5" />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-snug">
            {i.title}
            {isOpportunity(i) && <span className="rounded-full border border-lime/40 bg-lime/10 px-1.5 py-px text-[10px] font-medium text-lime">Opportunity</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {RULES[i.rule].label}
            {i.campaignName && <> · {i.campaignName}</>}
            {i.handledCount > 0 && i.state === "open" && <> · {i.handledCount} handled</>}
            {i.state === "snoozed" && i.snoozedUntil && <> · snoozed to {i.snoozedUntil}</>}
          </span>
        </span>
        {stake > 0 && (
          <span className="shrink-0 text-right">
            <span className="block text-sm tabular-nums">{money(stake, p.currency)}</span>
            <span className="block text-[11px] text-muted-foreground">{i.category === "waste" ? "wasted" : "spend behind it"}</span>
          </span>
        )}
        <span className={cn("mt-1 text-xs text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden>
          ›
        </span>
      </button>
      {open && <InsightDetail i={i} campaignHref={campaignHref} {...p} />}
    </div>
  )
}

type Panel = null | "brief" | "test" | "dismiss"

function InsightDetail({ i, campaignHref, ...p }: Omit<RowProps, "insight" | "open" | "onToggle"> & { i: FeedInsight; campaignHref: string | null }) {
  const listItems = i.state === "closed" ? i.items : i.open
  const [selected, setSelected] = useState<Set<string>>(() => new Set(listItems.map((x) => x.id)))
  const [panel, setPanel] = useState<Panel>(null)
  const [pending, start] = useTransition()
  const chosen = useMemo(() => (i.listed ? listItems.filter((x) => selected.has(x.id)) : listItems), [i.listed, listItems, selected])
  const ids = chosen.map((x) => x.id)
  const preview = p.previews[i.key]
  const rule = RULES[i.rule]

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    start(async () => {
      const r = await fn()
      if (r.ok) toast.success(r.message ?? success)
      else toast.error(r.message ?? "Something went wrong.")
    })
  const log = (action: "done" | "dismissed" | "snoozed" | "reopened", extra: { days?: number; note?: string } = {}) =>
    run(() => logInsight(p.slug, i.key, { action, items: action === "snoozed" || action === "reopened" ? [] : ids, ...extra }), { done: "Marked done.", dismissed: "Dismissed.", snoozed: "Snoozed.", reopened: "Reopened." }[action])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chosen.map((x) => x.label).join("\n"))
      toast.success(`Copied ${chosen.length} ${chosen.length === 1 ? "line" : "lines"}.`)
    } catch {
      toast.error("Couldn't copy. Select the list and copy it by hand.")
    }
  }

  const itemLines = chosen.map((x) => `- ${x.label}${x.note ? ` (${x.note})` : ""}${x.campaigns?.length ? `\n  Seen in: ${x.campaigns.join("; ")}` : ""}`).join("\n")
  const description = [`${i.why}`, `What to do: ${i.todo}`, i.listed && chosen.length ? `${i.itemsLabel ?? "Items"}:\n${itemLines}` : null, i.campaignName ? `Campaign: ${i.campaignName} (${platformName(i.platform)})` : null, `From "Optimise now" in Sauvignon Blanc (${rule.label}).`]
    .filter(Boolean)
    .join("\n\n")
  const shortTitle = `${p.clientName}: ${i.title}${i.campaignName ? ` (${i.campaignName})` : ""}`.slice(0, 200)

  return (
    <div className="space-y-5 px-5 pt-1 pb-5 sm:pl-[3.25rem]">
      <div className="space-y-3">
        <p className="text-sm">{i.why}</p>
        {i.numbers.length > 0 && (
          <dl className="flex flex-wrap gap-2">
            {i.numbers.map((n) => (
              <div key={n.label} className="min-w-32 rounded-lg border bg-card px-3 py-2">
                <dt className="text-[11px] text-muted-foreground">{n.label}</dt>
                <dd className={cn("mt-0.5 text-base tabular-nums", n.tone === "bad" && "text-rag-red", n.tone === "good" && "text-rag-green")}>{n.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {preview && (
          <div className="flex items-center gap-3">
            <AdThumb preview={preview} alt={i.items[0]?.label ?? "Ad"} size="md" />
          </div>
        )}
        <div className="rounded-lg border-l-2 border-lime bg-lime/5 px-3 py-2 text-sm">
          <span className="font-medium">What to do: </span>
          {i.todo}
        </div>
      </div>

      {i.listed && listItems.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="accent-lime"
                checked={selected.size === listItems.length}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < listItems.length
                }}
                onChange={(e) => setSelected(new Set(e.target.checked ? listItems.map((x) => x.id) : []))}
              />
              {i.itemsLabel ?? "Items"}: {selected.size} of {listItems.length} selected
            </label>
            <Button size="sm" variant="outline" className="h-7" disabled={!chosen.length} onClick={copy}>
              Copy {chosen.length === listItems.length ? "list" : "selected"}
            </Button>
          </div>
          <ul className="max-h-80 divide-y overflow-y-auto text-sm">
            {listItems.map((x) => (
              <li key={x.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-secondary/40">
                  <input
                    type="checkbox"
                    className="mt-1 accent-lime"
                    checked={selected.has(x.id)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(x.id)
                      else next.delete(x.id)
                      setSelected(next)
                    }}
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {x.label}
                    {x.flag && <span className="ml-2 rounded-full border border-rag-amber/40 bg-rag-amber/10 px-1.5 py-px text-[10px] font-medium text-rag-amber">{x.flag}</span>}
                    {x.campaigns && x.campaigns.length > 0 && <SeenIn campaigns={x.campaigns} />}
                  </span>
                  {x.note && <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">{x.note}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">Why am I seeing this?</summary>
        <p className="mt-1.5">
          {rule.rule}
          {i.campaignName && " The campaign's goal is read from its name; awareness campaigns aren't judged on cost per result."}
        </p>
      </details>

      {i.history.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {i.history.map((h, n) => (
            <li key={n}>
              {h.created_at.slice(0, 10)} · {h.profile_name ?? "Someone"} {ACTION_WORD[h.action]}
              {h.items.length > 0 && i.listed ? ` ${h.items.length} ${h.items.length === 1 ? "item" : "items"}` : ""}
              {h.snooze_until ? ` until ${h.snooze_until}` : ""}
              {h.note ? `: ${h.note}` : ""}
              {h.sprint_test_id && (
                <>
                  {" "}
                  <Link href={`/clients/${p.slug}/sprint#test-${h.sprint_test_id}`} className="underline hover:text-foreground">
                    open the test
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {panel === "brief" && (
        <BriefForm
          live={p.live}
          owners={p.owners}
          defaults={{ title: shortTitle, dueDate: p.defaultDue, description }}
          pending={pending}
          onCancel={() => setPanel(null)}
          onSubmit={(v) =>
            start(async () => {
              const r = await briefInsight(p.slug, i.key, { ...v, items: ids })
              if (!r.ok) return void toast.error(r.message ?? "Couldn't brief the team.")
              toast.success(r.message ?? "Briefed.")
              setPanel(null)
            })
          }
        />
      )}
      {panel === "test" && (
        <TestForm
          owners={p.owners}
          sprintNumber={p.sprintNumber}
          defaults={{ title: i.title.slice(0, 200), hypothesis: "", success_text: "", deadline: p.defaultDue }}
          pending={pending}
          onCancel={() => setPanel(null)}
          onSubmit={(v) =>
            start(async () => {
              const r = await testFromInsight(p.slug, i.key, { ...v, items: ids })
              if (!r.ok) return void toast.error(r.message ?? "Couldn't plan the test.")
              toast.success(r.message ?? "Planned.")
              setPanel(null)
            })
          }
        />
      )}
      {panel === "dismiss" && <DismissForm pending={pending} onCancel={() => setPanel(null)} onDismiss={(note) => {
            log("dismissed", { note })
            setPanel(null)
          }} />}

      {panel === null && (
        <div className="flex flex-wrap items-center gap-2">
          {i.state === "closed" || i.state === "snoozed" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => log("reopened")}>
              Reopen
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={pending || (i.listed && !chosen.length)} onClick={() => log("done")}>
                {i.listed && chosen.length < listItems.length ? `Done (${chosen.length})` : "Done"}
              </Button>
              <Button size="sm" variant="outline" disabled={pending || (i.listed && !chosen.length)} onClick={() => setPanel("brief")}>
                Brief the team
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setPanel("test")}>
                Make it a sprint test
              </Button>
              <select
                className={cn(fieldClass, "h-8 w-auto text-sm")}
                value=""
                disabled={pending}
                aria-label="Snooze"
                onChange={(e) => e.target.value && log("snoozed", { days: Number(e.target.value) })}
              >
                <option value="">Snooze…</option>
                <option value="7">For a week</option>
                <option value="14">For 2 weeks</option>
                <option value="30">For a month</option>
              </select>
              <Button size="sm" variant="ghost" disabled={pending || (i.listed && !chosen.length)} onClick={() => setPanel("dismiss")}>
                Dismiss
              </Button>
            </>
          )}
          {campaignHref && (
            <Link href={campaignHref} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              Open the campaign →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/** The campaigns an item was seen in: the first two, then the rest behind "and N more". */
function SeenIn({ campaigns }: { campaigns: string[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? campaigns : campaigns.slice(0, 2)
  return (
    <span className="mt-0.5 block text-xs text-muted-foreground">
      {campaigns.length === 1 ? "Campaign:" : "Campaigns:"}
      {shown.map((c, n) => (
        <span key={c} className="block truncate" title={c}>
          {c}
          {n === shown.length - 1 && campaigns.length > 2 && (
            <button
              type="button"
              className="ml-2 underline hover:text-foreground"
              onClick={(e) => {
                e.preventDefault() // the row is a label for its checkbox
                setAll(!all)
              }}
            >
              {all ? "show less" : `and ${campaigns.length - 2} more`}
            </button>
          )}
        </span>
      ))}
    </span>
  )
}

const ACTION_WORD: Record<FeedInsight["history"][number]["action"], string> = {
  done: "marked done",
  dismissed: "dismissed",
  snoozed: "snoozed it",
  briefed: "briefed the team on",
  tested: "made a sprint test of",
  reopened: "reopened it",
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function OwnerSelect({ owners, value, onChange, allowNone }: { owners: Owner[]; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <select className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowNone ? "No owner yet" : "Pick an owner"}</option>
      {owners
        .filter((o) => o.id)
        .map((o) => (
          <option key={o.id} value={o.id!}>
            {o.name}
            {o.onTeam ? "" : " (not on this client)"}
          </option>
        ))}
    </select>
  )
}

function BriefForm(props: {
  live: boolean
  owners: Owner[]
  defaults: { title: string; dueDate: string; description: string }
  pending: boolean
  onCancel: () => void
  onSubmit: (v: { title: string; ownerNotionId: string; dueDate: string | null; description: string }) => void
}) {
  const [title, setTitle] = useState(props.defaults.title)
  const [owner, setOwner] = useState(props.owners.find((o) => o.onTeam && o.id)?.id ?? "")
  const [due, setDue] = useState(props.defaults.dueDate)
  const [description, setDescription] = useState(props.defaults.description)
  return (
    <div className="grid gap-3 rounded-lg border bg-background/60 p-4 sm:grid-cols-2">
      <p className="text-sm font-medium sm:col-span-2">Brief the team: a Notion action on the Master Production board</p>
      {!props.live && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          <strong className="text-foreground">Test mode.</strong> Notion writes are switched off, so this records what would be created and sends nothing to Notion.
        </p>
      )}
      <Field label="Title" className="sm:col-span-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Owner">
        <OwnerSelect owners={props.owners} value={owner} onChange={setOwner} />
      </Field>
      <Field label="Due">
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea rows={8} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" disabled={props.pending || !owner || !title.trim()} onClick={() => props.onSubmit({ title, ownerNotionId: owner, dueDate: due || null, description })}>
          {props.pending ? "Saving…" : props.live ? "Create the Notion action" : "Record the dry run"}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function TestForm(props: {
  owners: Owner[]
  sprintNumber: number
  defaults: { title: string; hypothesis: string; success_text: string; deadline: string }
  pending: boolean
  onCancel: () => void
  onSubmit: (v: { title: string; hypothesis: string; success_text: string; owner_notion_user_id: string | null; deadline: string | null }) => void
}) {
  const [title, setTitle] = useState(props.defaults.title)
  const [hypothesis, setHypothesis] = useState(props.defaults.hypothesis)
  const [success, setSuccess] = useState(props.defaults.success_text)
  const [owner, setOwner] = useState(props.owners.find((o) => o.onTeam && o.id)?.id ?? "")
  const [deadline, setDeadline] = useState(props.defaults.deadline)
  return (
    <div className="grid gap-3 rounded-lg border bg-background/60 p-4 sm:grid-cols-2">
      <p className="text-sm font-medium sm:col-span-2">Plan it as a test in Sprint {props.sprintNumber}</p>
      <Field label="What we're testing" className="sm:col-span-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Hypothesis" className="sm:col-span-2">
        <Input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="If we…, then…, because…" />
      </Field>
      <Field label="What success looks like" className="sm:col-span-2">
        <Input value={success} onChange={(e) => setSuccess(e.target.value)} placeholder="e.g. cost per result back under target within 2 weeks" />
      </Field>
      <Field label="Owner">
        <OwnerSelect owners={props.owners} value={owner} onChange={setOwner} allowNone />
      </Field>
      <Field label="Deadline">
        <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">The insight&apos;s numbers and list go into the test&apos;s brief notes. Nothing goes to Notion until someone clicks &ldquo;Brief the team&rdquo; on the test.</p>
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" disabled={props.pending || !title.trim() || !success.trim()} onClick={() => props.onSubmit({ title, hypothesis, success_text: success, owner_notion_user_id: owner || null, deadline: deadline || null })}>
          {props.pending ? "Planning…" : "Plan the test"}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function DismissForm({ pending, onDismiss, onCancel }: { pending: boolean; onDismiss: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("")
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/60 p-3">
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional, helps us tune the rules)" className="h-8 min-w-0 flex-1" autoFocus />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => onDismiss(note)}>
        Dismiss
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
