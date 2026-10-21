"use client"

import { AlertTriangle, Pencil, Check as CheckIcon, Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { Spinner } from "@/components/loading"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Question } from "@/lib/campaign-builder/plan-schema"
import { platformPresetByKey } from "@/lib/campaign-builder/platform-presets"
import {
  BUILD_PLATFORM_LABEL,
  BUILDABLE,
  draftToSpec,
  knownLocation,
  ROUTE,
  type GoogleDraft,
  type MetaDraft,
  type MicrosoftDraft,
  type OtherPlatform,
  type PlatformPlan,
  type RedditDraft,
} from "@/lib/campaign-builder/platform-plan"
import { conversionKey, fromConversionKey } from "@/lib/ads-api/meta-ids"
import { META_CTAS, META_GOALS, META_OBJECTIVES } from "@/lib/ads-api/spec-platforms"
import { money, shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { BuildOutcome } from "./actions"
import { usePlanPoll } from "./builder-view"
import { buildFromPlatformPlan, metaAccountAssets, savePlatformPlan } from "./platform-actions"
import { Count, Failed, Field, ImageSlot, Outcome, Proposal, Questions, Section, Setting, Why, words } from "./plan-panel"

export type PlatformPlanRow = {
  id: string
  platform: OtherPlatform
  preset: string
  request: string
  status: "planning" | "questions" | "ready" | "failed"
  questions: Question[]
  answers: Record<string, string>
  plan: PlatformPlan | null
  error: string | null
  buildId: string | null
  createdAt: string
  by: string | null
}

export type PlatformPanelProps = {
  slug: string
  currency: string
  canBuild: boolean
  buildLive: boolean
  accounts: { id: string; name: string }[]
  builds: { id: string; status: string }[]
}

/** Where each platform's campaigns are turned on by hand. */
export const MANAGER: Record<OtherPlatform, string> = { google_ads: "Google Ads", meta: "Ads Manager", reddit: "Reddit Ads", microsoft_ads: "Microsoft Advertising" }

/** One plan on Google Ads, Meta, Reddit or Microsoft Ads: questions, then the plan to review, edit and build. */
export function PlatformPlanPanel(p: PlatformPanelProps & { row: PlatformPlanRow; onClose: () => void }) {
  const router = useRouter()
  const row = p.row
  usePlanPoll(row.id, row.status === "planning", () => router.refresh())
  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="eyebrow">
            {BUILD_PLATFORM_LABEL[row.platform]} · {platformPresetByKey(row.preset)?.label ?? row.preset}
          </div>
          <h2 className="truncate text-xl">{row.plan?.draft.campaign.name ?? "New campaign"}</h2>
        </div>
        <Button variant="outline" size="sm" onClick={p.onClose}>
          New campaign
        </Button>
      </div>
      {row.status === "planning" && (
        <div className="flex items-center gap-3 px-4 py-6 text-sm text-muted-foreground">
          <Spinner label="Planning" /> Planning. About a minute.
        </div>
      )}
      {row.status === "failed" && <Failed row={row} canBuild={p.canBuild} />}
      {row.status === "questions" && row.questions.length > 0 && <Questions row={row} />}
      {row.plan && row.status !== "planning" && <Editor key={row.id + row.plan.draft.campaign.name} {...p} initial={row.plan} />}
    </section>
  )
}

function Editor(p: PlatformPanelProps & { row: PlatformPlanRow; initial: PlatformPlan }) {
  const [plan, setPlan] = useState<PlatformPlan>(p.initial)
  const [accountId, setAccountId] = useState(p.accounts[0]?.id ?? "")
  const [outcome, setOutcome] = useState<(BuildOutcome & { missing?: string[] }) | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()
  const m = (n: number) => money(n, p.currency, n % 1 ? 2 : 0)
  const locked = Boolean(p.row.buildId && p.builds.find((b) => b.id === p.row.buildId)?.status === "created")
  const ready = draftToSpec(plan)
  const name = BUILD_PLATFORM_LABEL[plan.platform]

  const save = () =>
    start(async () => {
      const r = await savePlatformPlan(p.slug, p.row.id, plan)
      setSaved(r.ok ? "Saved" : (r.error ?? "Couldn't save."))
    })
  const build = () =>
    start(async () => {
      setOutcome(null)
      const r = await buildFromPlatformPlan(p.slug, p.row.id, plan, accountId, p.buildLive)
      setOutcome({ ok: r.ok, check: r.check, run: r.run, leftOut: r.leftOut, missing: r.missing, error: r.error })
      router.refresh()
    })

  return (
    <div className="divide-y">
      <Overview plan={plan} m={m} />
      {plan.proposal && <Proposal proposal={plan.proposal} />}
      {plan.platform === "google_ads" && <SearchEditor slug={p.slug} platform="google_ads" draft={plan.draft} m={m} onChange={(draft) => setPlan({ ...plan, draft: draft as GoogleDraft })} />}
      {plan.platform === "microsoft_ads" && <SearchEditor slug={p.slug} platform="microsoft_ads" draft={plan.draft} m={m} onChange={(draft) => setPlan({ ...plan, draft: draft as MicrosoftDraft })} />}
      {plan.platform === "meta" && <MetaEditor slug={p.slug} accountId={accountId} draft={plan.draft} m={m} onChange={(draft) => setPlan({ ...plan, draft })} />}
      {plan.platform === "reddit" && <RedditEditor draft={plan.draft} m={m} onChange={(draft) => setPlan({ ...plan, draft })} />}
      <Why plan={plan} />

      <div className="sticky bottom-0 space-y-3 bg-card px-4 py-3">
        {(ready.missing.length > 0 || ready.leftOut.length > 0) && !outcome && (
          <ul className="space-y-1 text-[13px]">
            {ready.missing.map((x) => (
              <li key={x} className="flex gap-2 text-rag-amber">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {x}
              </li>
            ))}
            {ready.leftOut.length > 0 && <li className="text-muted-foreground">Left out of the build: {ready.leftOut.join("; ")}.</li>}
          </ul>
        )}
        {outcome && (
          <>
            {outcome.missing && outcome.missing.length > 0 && <p className="text-[13px] text-rag-amber">Still needed: {outcome.missing.join(" ")}</p>}
            <Outcome outcome={outcome} live={p.buildLive} platform={name} manager={MANAGER[plan.platform]} />
          </>
        )}
        {!ROUTE[plan.platform].verified && <p className="text-xs text-muted-foreground">Sent through {ROUTE[plan.platform].via}. Not yet checked against a live {name} account: run a dry run first and check its log.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label={`${name} ad account`} className={cn(fieldClass, "w-auto")} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {!p.accounts.length && <option value="">No {name} account mapped</option>}
            {p.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="flex-1 text-xs text-muted-foreground">{saved}</span>
          <Button variant="outline" onClick={save} disabled={pending || !p.canBuild || locked}>
            Save
          </Button>
          <Button onClick={build} disabled={pending || !p.canBuild || !accountId || locked || !ready.spec} title={locked ? "This plan's campaign was created; edit it from the campaign list" : !ready.spec ? "Fill in what's still needed first" : undefined}>
            {pending ? "Working…" : p.buildLive ? `Build paused in ${name}` : "Dry run"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The plan in one sentence, then the numbers that matter in one line. */
function Overview({ plan, m }: { plan: PlatformPlan; m: (n: number) => string }) {
  const facts: string[] = []
  if (plan.platform === "google_ads" || plan.platform === "microsoft_ads") {
    const d = plan.draft
    facts.push("Search", `${m(d.campaign.dailyBudget)} a day`, words(d.campaign.bidding.replace(/([a-z])([A-Z])/g, "$1_$2")), `${d.adGroups.length} ad group${d.adGroups.length === 1 ? "" : "s"}`, `${d.adGroups.reduce((n, g) => n + g.keywords.length, 0)} keywords`)
  } else if (plan.platform === "meta") {
    const d = plan.draft
    facts.push(words(d.campaign.objective.replace("OUTCOME_", "")), `${m(d.adSet.dailyBudget)} a day`, `from ${shortDate(d.adSet.startDate)}`, `${d.ads.length} ad${d.ads.length === 1 ? "" : "s"}`)
  } else {
    const d = plan.draft
    facts.push(words(d.campaign.objective), `${m(d.adGroup.dailyBudget)} a day`, `from ${shortDate(d.adGroup.startDate)}`, `${d.ads.length} ad${d.ads.length === 1 ? "" : "s"}`)
  }
  return (
    <div className="space-y-3 px-4 py-4">
      <p className="text-[15px] leading-relaxed text-foreground">{plan.summary}</p>
      <p className="flex flex-wrap gap-1.5">
        {facts.map((f) => (
          <span key={f} className="pill">
            {f}
          </span>
        ))}
      </p>
      {plan.structure.length > 1 && (
        <ol className="space-y-1 text-[13px]">
          {plan.structure.map((s, i) => (
            <li key={i} className="flex min-w-0 gap-2">
              <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="truncate" title={s.purpose}>
                <span className="text-foreground">{s.name}</span> <span className="text-muted-foreground">{s.purpose}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">The app builds {BUILDABLE[plan.platform]}.</p>
    </div>
  )
}

// ------------------------------------------------------------------ small editors

/** A list of words edited as one comma-separated field. */
function ListInput({ value, onChange, label, placeholder, upper }: { value: string[]; onChange: (v: string[]) => void; label: string; placeholder?: string; upper?: boolean }) {
  const [text, setText] = useState(value.join(", "))
  return (
    <Input
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const list = text
          .split(/[,\n]/)
          .map((s) => (upper ? s.trim().toUpperCase() : s.trim()))
          .filter(Boolean)
        onChange(list)
        setText(list.join(", "))
      }}
    />
  )
}

/** One line per item (headlines, descriptions), with each line's length against the platform's limit. */
function LinesInput({ value, onChange, label, max, rows = 6 }: { value: string[]; onChange: (v: string[]) => void; label: string; max: number; rows?: number }) {
  return (
    <div>
      <Textarea aria-label={label} rows={rows} value={value.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} placeholder={`${label}, one per line`} />
      <ul className="mt-1 flex flex-wrap gap-1">
        {value.filter(Boolean).map((l, i) => (
          <li key={i} className={cn("text-[11px] tabular-nums", l.length > max ? "text-rag-red" : "text-muted-foreground")} title={l}>
            {l.length}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Keywords in Google's own notation, one per line: [exact], "phrase", broad.
 * The same notation works for Microsoft Ads.
 */
const kwToText = (k: { text: string; match: string }) => (k.match === "EXACT" ? `[${k.text}]` : k.match === "PHRASE" ? `"${k.text}"` : k.text)
const textToKw = (line: string) => {
  const t = line.trim()
  if (/^\[.*\]$/.test(t)) return { text: t.slice(1, -1).trim(), match: "EXACT" as const }
  if (/^".*"$/.test(t)) return { text: t.slice(1, -1).trim(), match: "PHRASE" as const }
  return { text: t, match: "BROAD" as const }
}

function KeywordsInput({ value, onChange }: { value: { text: string; match: "EXACT" | "PHRASE" | "BROAD" }[]; onChange: (v: { text: string; match: "EXACT" | "PHRASE" | "BROAD" }[]) => void }) {
  const [text, setText] = useState(value.map(kwToText).join("\n"))
  return (
    <div className="space-y-1">
      <Textarea
        aria-label="Keywords"
        rows={Math.min(10, Math.max(3, value.length + 1))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split("\n").filter((l) => l.trim()).map(textToKw).filter((k) => k.text))}
        placeholder={'[exact match]\n"phrase match"\nbroad match'}
      />
      <p className="text-xs text-muted-foreground">One per line: [exact], &quot;phrase&quot;, broad.</p>
    </div>
  )
}

// ------------------------------------------------------------------ Google Ads and Microsoft Ads

type SearchDraft = GoogleDraft | MicrosoftDraft
const GOOGLE_BIDDING = { maximize_conversions: "Maximize conversions", manual_cpc: "Manual CPC", target_spend: "Maximize clicks" } as const
const MICROSOFT_BIDDING = { MaxConversions: "Maximize conversions", EnhancedCpc: "Enhanced CPC", ManualCpc: "Manual CPC", MaxClicks: "Maximize clicks" } as const

function SearchEditor({ slug, platform, draft, m, onChange }: { slug: string; platform: "google_ads" | "microsoft_ads"; draft: SearchDraft; m: (n: number) => string; onChange: (d: SearchDraft) => void }) {
  const c = draft.campaign
  const set = (patch: Partial<SearchDraft["campaign"]>) => onChange({ ...draft, campaign: { ...c, ...patch } } as SearchDraft)
  const bidding: Record<string, string> = platform === "google_ads" ? GOOGLE_BIDDING : MICROSOFT_BIDDING
  const setGroup = (i: number, patch: Partial<SearchDraft["adGroups"][number]>) => onChange({ ...draft, adGroups: draft.adGroups.map((g, j) => (j === i ? { ...g, ...patch } : g)) } as SearchDraft)
  void slug
  return (
    <>
      <Section title="Campaign">
        <dl className="divide-y rounded-md border">
          <Setting label="Campaign name" value={c.name}>
            <Input aria-label="Campaign name" value={c.name} onChange={(e) => set({ name: e.target.value })} />
          </Setting>
          <Setting label="Type" value="Search, created paused" />
          <Setting label="Bidding" value={bidding[c.bidding] ?? c.bidding}>
            <select aria-label="Bidding" className={fieldClass} value={c.bidding} onChange={(e) => set({ bidding: e.target.value as never })}>
              {Object.entries(bidding).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Setting>
          <Setting label="Daily budget" value={<>{m(c.dailyBudget)} a day <span className="text-muted-foreground">· about {m(c.dailyBudget * 30)} a month</span></>}>
            <Input aria-label="Daily budget" type="number" min={1} step="1" value={c.dailyBudget} onChange={(e) => set({ dailyBudget: Number(e.target.value) })} className="sm:max-w-40" />
          </Setting>
          <Setting label="Locations" value={<Locations list={c.locations} />} startOpen={c.locations.some((l) => !l.id)}>
            <LocationsEditor platform={platform} list={c.locations} onChange={(locations) => set({ locations })} />
          </Setting>
          <Setting label="Languages" value={c.languages.join(", ") || "All"}>
            <ListInput label="Languages" value={c.languages} onChange={(languages) => set({ languages })} placeholder={platform === "google_ads" ? "en, de" : "English, German"} />
          </Setting>
        </dl>
      </Section>

      <Section title={`Ad groups · ${draft.adGroups.length}`}>
        <div className="space-y-3">
          {draft.adGroups.map((g, i) => (
            <div key={i} className="rounded-md border">
              <div className="grid gap-3 border-b p-3 sm:grid-cols-[1fr_140px]">
                <Field label="Ad group" id={`ag-${i}`}>
                  <Input id={`ag-${i}`} value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} />
                </Field>
                <Field label="Max CPC" id={`ag-cpc-${i}`}>
                  <Input id={`ag-cpc-${i}`} type="number" min={0} step="0.01" value={g.cpcBid ?? ""} onChange={(e) => setGroup(i, { cpcBid: e.target.value ? Number(e.target.value) : null })} placeholder="Automatic" />
                </Field>
              </div>
              <div className="grid gap-4 p-3 lg:grid-cols-[280px_minmax(0,1fr)]">
                <KeywordsInput value={g.keywords} onChange={(keywords) => setGroup(i, { keywords })} />
                <div className="space-y-3">
                  {g.ads.map((ad, j) => (
                    <SearchAdCard key={j} ad={ad} onChange={(patch) => setGroup(i, { ads: g.ads.map((a, k) => (k === j ? { ...a, ...patch } : a)) })} />
                  ))}
                  {g.ads.length < 3 && (
                    <Button size="sm" variant="outline" onClick={() => setGroup(i, { ads: [...g.ads, { headlines: [], descriptions: [], finalUrl: g.ads[0]?.finalUrl ?? "", path1: "", path2: "", fromProposal: false }] })}>
                      <Plus aria-hidden /> Add an ad
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {"sitelinks" in draft && (
        <Section title="Sitelinks and callouts">
          <dl className="divide-y rounded-md border">
            <Setting label="Sitelinks" value={draft.sitelinks.map((s) => s.text).join(", ") || "None"}>
              <div className="space-y-2">
                {draft.sitelinks.map((s, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                    <Input aria-label="Sitelink text" value={s.text} onChange={(e) => onChange({ ...draft, sitelinks: draft.sitelinks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                    <Input aria-label="Sitelink link" value={s.finalUrl} onChange={(e) => onChange({ ...draft, sitelinks: draft.sitelinks.map((x, j) => (j === i ? { ...x, finalUrl: e.target.value } : x)) })} />
                    <Button size="icon" variant="ghost" aria-label="Remove sitelink" onClick={() => onChange({ ...draft, sitelinks: draft.sitelinks.filter((_, j) => j !== i) })}>
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
                {draft.sitelinks.length < 8 && (
                  <Button size="sm" variant="outline" onClick={() => onChange({ ...draft, sitelinks: [...draft.sitelinks, { text: "", finalUrl: "", description1: "", description2: "" }] })}>
                    <Plus aria-hidden /> Add a sitelink
                  </Button>
                )}
              </div>
            </Setting>
            <Setting label="Callouts" value={draft.callouts.join(", ") || "None"}>
              <ListInput label="Callouts" value={draft.callouts} onChange={(callouts) => onChange({ ...draft, callouts })} placeholder="Set up in minutes, 14-day free trial" />
            </Setting>
          </dl>
        </Section>
      )}
      <NotBuilt list={draft.notBuilt} where={platform === "google_ads" ? "Google Ads" : "Microsoft Advertising"} />
    </>
  )
}

function Locations({ list }: { list: { id: number | null; name: string }[] }) {
  if (!list.length) return <span className="text-rag-amber">None yet</span>
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((l) => (
        <span key={l.name} className={cn("pill", !l.id && "border-rag-amber/60 text-rag-amber")} title={l.id ? `id ${l.id}` : "Needs its id"}>
          {l.name}
        </span>
      ))}
    </span>
  )
}

function LocationsEditor({ platform, list, onChange }: { platform: "google_ads" | "microsoft_ads"; list: { id: number | null; name: string }[]; onChange: (v: { id: number | null; name: string }[]) => void }) {
  const [name, setName] = useState("")
  const [id, setId] = useState("")
  const add = () => {
    const n = name.trim()
    if (!n) return
    onChange([...list, { name: n, id: Number(id) || knownLocation(platform, n) }])
    setName("")
    setId("")
  }
  return (
    <div className="space-y-2">
      {list.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_120px_auto] items-center gap-2">
          <span className="text-[13px]">{l.name}</span>
          <Input aria-label={`${l.name} id`} type="number" value={l.id ?? ""} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, id: Number(e.target.value) || null } : x)))} placeholder="Location id" />
          <Button size="icon" variant="ghost" aria-label={`Remove ${l.name}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_120px_auto] gap-2">
        <Input aria-label="Location" value={name} onChange={(e) => setName(e.target.value)} placeholder="United States" onKeyDown={(e) => e.key === "Enter" && add()} />
        <Input aria-label="Location id" type="number" value={id} onChange={(e) => setId(e.target.value)} placeholder="id" />
        <Button size="sm" variant="outline" onClick={add}>
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {platform === "google_ads" ? "Google's geo target ids (United States 2840, United Kingdom 2826; others in Google's geo targets table)." : "Microsoft's location ids (United States 190, United Kingdom 188; unverified)."}
      </p>
    </div>
  )
}

type SearchAd = GoogleDraft["adGroups"][number]["ads"][number]

/** A responsive search ad as a Google result, with a pencil to edit its lines. */
function SearchAdCard({ ad, onChange }: { ad: SearchAd; onChange: (patch: Partial<SearchAd>) => void }) {
  const [editing, setEditing] = useState(false)
  const host = (() => {
    try {
      return new URL(ad.finalUrl).hostname.replace(/^www\./, "")
    } catch {
      return "No landing page"
    }
  })()
  const tooLong = ad.headlines.some((h) => h.length > 30) || ad.descriptions.some((d) => d.length > 90)
  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {ad.headlines.filter(Boolean).length} headlines · {ad.descriptions.filter(Boolean).length} descriptions
        </span>
        {ad.fromProposal && <span className="pill">Proposal</span>}
        {tooLong && <span className="pill text-rag-red">Too long</span>}
        <button type="button" onClick={() => setEditing(!editing)} aria-label={editing ? "Done editing the ad" : "Edit the ad"} aria-expanded={editing} className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-lime focus-visible:outline-none">
          {editing ? <CheckIcon className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
        </button>
      </div>
      {editing ? (
        <div className="grid gap-3 p-3 sm:grid-cols-2">
          <LinesInput label="Headlines" value={ad.headlines} onChange={(headlines) => onChange({ headlines })} max={30} rows={8} />
          <div className="space-y-2">
            <LinesInput label="Descriptions" value={ad.descriptions} onChange={(descriptions) => onChange({ descriptions })} max={90} rows={4} />
            <Input aria-label="Landing page" value={ad.finalUrl} onChange={(e) => onChange({ finalUrl: e.target.value })} placeholder="Landing page" />
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label="Path 1" value={ad.path1} onChange={(e) => onChange({ path1: e.target.value })} placeholder="Path 1" />
              <Input aria-label="Path 2" value={ad.path2} onChange={(e) => onChange({ path2: e.target.value })} placeholder="Path 2" />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1 px-3 py-3">
          <p className="text-xs text-body">
            Sponsored · {host}
            {ad.path1 ? `/${ad.path1}` : ""}
            {ad.path2 ? `/${ad.path2}` : ""}
          </p>
          <p className="text-[15px] leading-snug text-[#8ab4f8]">{ad.headlines.filter(Boolean).slice(0, 3).join(" | ") || "No headlines yet"}</p>
          <p className="text-[13px] text-body">{ad.descriptions.filter(Boolean).slice(0, 2).join(" ")}</p>
        </div>
      )}
    </div>
  )
}

function NotBuilt({ list, where }: { list: { name: string; format: string; brief: string }[]; where: string }) {
  if (!list.length) return null
  return (
    <Section title={`Built in ${where}`}>
      <ul className="divide-y rounded-md border text-[13px]">
        {list.map((n, i) => (
          <li key={i} className="space-y-0.5 px-3 py-2">
            <p className="text-foreground">
              {n.name} <span className="pill ml-1">{n.format}</span>
            </p>
            {n.brief && <p className="text-muted-foreground">{n.brief}</p>}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ------------------------------------------------------------------ Meta

type MetaAssets = Awaited<ReturnType<typeof metaAccountAssets>>

function MetaEditor({ slug, accountId, draft, m, onChange }: { slug: string; accountId: string; draft: MetaDraft; m: (n: number) => string; onChange: (d: MetaDraft) => void }) {
  // What was read belongs to the account it was read for, so switching accounts never shows the old one's.
  const [read, setRead] = useState<{ accountId: string; assets: MetaAssets } | null>(null)
  useEffect(() => {
    if (!accountId) return
    let live = true
    metaAccountAssets(slug, accountId).then((a) => live && setRead({ accountId, assets: a }))
    return () => {
      live = false
    }
  }, [slug, accountId])
  const assets = read?.accountId === accountId ? read.assets : null
  const loading = Boolean(accountId) && !assets
  const ok = assets && "pages" in assets ? assets : null
  const s = draft.adSet
  const t = s.targeting
  const setSet = (patch: Partial<MetaDraft["adSet"]>) => onChange({ ...draft, adSet: { ...s, ...patch } })
  const setT = (patch: Partial<MetaDraft["adSet"]["targeting"]>) => setSet({ targeting: { ...t, ...patch } })
  const lead = s.optimizationGoal === "LEAD_GENERATION"
  const base = ok?.adSets.find((a) => a.id === t.baseAdSetId)

  return (
    <>
      <Section title="Campaign and ad set">
        {loading && <p className="text-xs text-muted-foreground">Reading the account&apos;s pages, pixels and ad sets…</p>}
        {assets && "error" in assets && <p className="text-xs text-rag-amber">{String(assets.error)}</p>}
        <dl className="divide-y rounded-md border">
          <Setting label="Facebook page" value={draft.pageId ? (ok?.pages.find((x) => x.id === draft.pageId)?.name ?? draft.pageId) : <span className="text-rag-amber">Not picked yet</span>} startOpen={!draft.pageId}>
            <IdPicker label="Facebook page" value={draft.pageId} options={(ok?.pages ?? []).map((x) => ({ id: x.id, name: x.name ?? x.id }))} onChange={(pageId) => onChange({ ...draft, pageId })} />
          </Setting>
          <Setting label="Campaign name" value={draft.campaign.name}>
            <Input aria-label="Campaign name" value={draft.campaign.name} onChange={(e) => onChange({ ...draft, campaign: { ...draft.campaign, name: e.target.value } })} />
          </Setting>
          <Setting label="Objective" value={words(draft.campaign.objective.replace("OUTCOME_", ""))}>
            <select aria-label="Objective" className={fieldClass} value={draft.campaign.objective} onChange={(e) => onChange({ ...draft, campaign: { ...draft.campaign, objective: e.target.value as MetaDraft["campaign"]["objective"] } })}>
              {META_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {words(o.replace("OUTCOME_", ""))}
                </option>
              ))}
            </select>
          </Setting>
          <Setting label="Ad set name" value={s.name}>
            <Input aria-label="Ad set name" value={s.name} onChange={(e) => setSet({ name: e.target.value })} />
          </Setting>
          <Setting label="Optimize for" value={words(s.optimizationGoal)}>
            <select aria-label="Optimize for" className={fieldClass} value={s.optimizationGoal} onChange={(e) => setSet({ optimizationGoal: e.target.value as MetaDraft["adSet"]["optimizationGoal"] })}>
              {META_GOALS.map((o) => (
                <option key={o} value={o}>
                  {words(o)}
                </option>
              ))}
            </select>
          </Setting>
          {s.optimizationGoal === "OFFSITE_CONVERSIONS" && (
            <Setting label="Conversion" value={s.pixel ? `${s.pixel.event} · pixel ${s.pixel.pixelId}` : <span className="text-rag-amber">Not picked yet</span>} startOpen={!s.pixel}>
              <select
                aria-label="Conversion"
                className={fieldClass}
                value={s.pixel ? conversionKey(s.pixel) : ""}
                onChange={(e) => setSet({ pixel: fromConversionKey(e.target.value) })}
              >
                <option value="">Pick a conversion…</option>
                {(ok?.conversions ?? []).map((c) => (
                  <option key={conversionKey(c)} value={conversionKey(c)}>
                    {c.event}
                    {c.customConversionId ? " (custom conversion)" : ""} · pixel {c.pixelId}
                  </option>
                ))}
                {s.pixel && !ok?.conversions.some((c) => conversionKey(c) === conversionKey(s.pixel!)) && <option value={conversionKey(s.pixel)}>{s.pixel.event}</option>}
              </select>
            </Setting>
          )}
          <Setting
            label="Audience"
            value={
              <span className="space-y-0.5">
                <span className="block">
                  {t.countries.join(", ") || <span className="text-rag-amber">No country</span>} · ages {t.ageMin}–{t.ageMax}
                  {t.ageMax === 65 ? "+" : ""}
                </span>
                {t.baseAdSetId && <span className="block text-muted-foreground">Starts from {base?.name ?? t.baseAdSetName ?? t.baseAdSetId}</span>}
                {t.customAudiences.length > 0 && <span className="block text-muted-foreground">Audiences: {t.customAudiences.map((a) => a.name).join(", ")}</span>}
                {t.excludedAudiences.length > 0 && <span className="block text-muted-foreground">Excluded: {t.excludedAudiences.map((a) => a.name).join(", ")}</span>}
                <span className="block text-muted-foreground">
                  Advantage+ audience {t.advantageAudience ? "on" : "off"} · Audience Network {t.audienceNetwork ? "on" : "off"}
                </span>
              </span>
            }
          >
            <div className="space-y-3">
              <Field label="Start from an ad set's audience" id="meta-base">
                <select id="meta-base" className={fieldClass} value={t.baseAdSetId ?? ""} onChange={(e) => setT({ baseAdSetId: e.target.value || null, baseAdSetName: ok?.adSets.find((a) => a.id === e.target.value)?.name ?? "" })}>
                  <option value="">None (countries and ages only)</option>
                  {(ok?.adSets ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.summary}
                    </option>
                  ))}
                  {t.baseAdSetId && !ok?.adSets.some((a) => a.id === t.baseAdSetId) && <option value={t.baseAdSetId}>{t.baseAdSetName || t.baseAdSetId}</option>}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Countries" id="meta-countries">
                  <ListInput label="Countries" value={t.countries} onChange={(countries) => setT({ countries })} placeholder="US, GB" upper />
                </Field>
                <Field label="Youngest" id="meta-agemin">
                  <Input id="meta-agemin" type="number" min={18} max={65} value={t.ageMin} onChange={(e) => setT({ ageMin: Number(e.target.value) })} />
                </Field>
                <Field label="Oldest (65 = 65+)" id="meta-agemax">
                  <Input id="meta-agemax" type="number" min={18} max={65} value={t.ageMax} onChange={(e) => setT({ ageMax: Number(e.target.value) })} />
                </Field>
              </div>
              <AudienceList label="Custom audiences" list={t.customAudiences} known={base?.customAudiences ?? []} onChange={(customAudiences) => setT({ customAudiences })} />
              <AudienceList label="Excluded audiences" list={t.excludedAudiences} known={base?.customAudiences ?? []} onChange={(excludedAudiences) => setT({ excludedAudiences })} />
              <label className="flex items-center gap-2 text-[13px] text-body">
                <input type="checkbox" checked={t.advantageAudience} onChange={(e) => setT({ advantageAudience: e.target.checked })} />
                Advantage+ audience (Meta may go beyond these audiences)
              </label>
              <label className="flex items-center gap-2 text-[13px] text-body">
                <input type="checkbox" checked={t.audienceNetwork} onChange={(e) => setT({ audienceNetwork: e.target.checked })} />
                Audience Network placements
              </label>
            </div>
          </Setting>
          <Setting
            label="Budget and schedule"
            value={
              <>
                {m(s.dailyBudget)} a day <span className="text-muted-foreground">· about {m(s.dailyBudget * 30)} a month</span>
                <span className="block">
                  {shortDate(s.startDate)} – {s.endDate ? shortDate(s.endDate) : "no end date"}
                </span>
              </>
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Daily budget" id="meta-budget">
                <Input id="meta-budget" type="number" min={1} step="1" value={s.dailyBudget} onChange={(e) => setSet({ dailyBudget: Number(e.target.value) })} />
              </Field>
              <Field label="Start" id="meta-start">
                <Input id="meta-start" type="date" value={s.startDate} onChange={(e) => setSet({ startDate: e.target.value })} />
              </Field>
              <Field label="End" id="meta-end">
                <Input id="meta-end" type="date" value={s.endDate ?? ""} onChange={(e) => setSet({ endDate: e.target.value || null })} />
              </Field>
            </div>
          </Setting>
        </dl>
      </Section>

      <Section title={`Ads · ${draft.ads.length}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          {draft.ads.map((ad, i) => (
            <MetaAdCard key={i} slug={slug} ad={ad} lead={lead} onChange={(patch) => onChange({ ...draft, ads: draft.ads.map((a, j) => (j === i ? { ...a, ...patch } : a)) })} />
          ))}
        </div>
      </Section>
      <NotBuilt list={draft.notBuilt} where="Ads Manager" />
    </>
  )
}

/** Pick an id from what the account uses, or paste one. */
function IdPicker({ label, value, options, onChange }: { label: string; value: string | null; options: { id: string; name: string }[]; onChange: (v: string | null) => void }) {
  const [manual, setManual] = useState("")
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.length > 0 && (
        <select aria-label={label} className={cn(fieldClass, "w-auto")} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Pick…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <Input aria-label={`${label} id`} className="w-56" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="or paste its id" />
      <Button size="sm" variant="outline" disabled={!/^\d+$/.test(manual.trim())} onClick={() => onChange(manual.trim())}>
        Use
      </Button>
    </div>
  )
}

function AudienceList({ label, list, known, onChange }: { label: string; list: { id: string | null; name: string }[]; known: { id: string; name: string }[]; onChange: (v: { id: string | null; name: string }[]) => void }) {
  const [id, setId] = useState("")
  const [name, setName] = useState("")
  const offer = known.filter((k) => !list.some((x) => x.id === k.id))
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {list.map((a, i) => (
          <span key={i} className={cn("pill gap-1", !a.id && "border-rag-amber/60 text-rag-amber")} title={a.id ? `id ${a.id}` : "Needs its id"}>
            {a.name}
            <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        {!list.length && <span className="text-xs text-muted-foreground">None</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {offer.length > 0 && (
          <select aria-label={`Add to ${label.toLowerCase()}`} className={cn(fieldClass, "w-auto")} value="" onChange={(e) => {
            const k = known.find((x) => x.id === e.target.value)
            if (k) onChange([...list, k])
          }}>
            <option value="">From the ad set…</option>
            {offer.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name || k.id}
              </option>
            ))}
          </select>
        )}
        <Input aria-label="Audience name" className="w-40" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <Input aria-label="Audience id" className="w-40" value={id} onChange={(e) => setId(e.target.value)} placeholder="Audience id" />
        <Button size="sm" variant="outline" disabled={!/^\d+$/.test(id.trim())} onClick={() => {
          onChange([...list, { id: id.trim(), name: name.trim() || id.trim() }])
          setId("")
          setName("")
        }}>
          Add
        </Button>
      </div>
    </div>
  )
}

type MetaAd = MetaDraft["ads"][number]

/** An ad as it shows in the feed (primary text, image, headline and button), with a pencil to edit it. */
function MetaAdCard({ slug, ad, lead, onChange }: { slug: string; ad: MetaAd; lead: boolean; onChange: (patch: Partial<MetaAd>) => void }) {
  const [editing, setEditing] = useState(false)
  const image = ad.format === "single_image"
  return (
    <div className="flex flex-col overflow-hidden rounded-md border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={ad.name}>
          {ad.name}
        </span>
        {ad.fromProposal && <span className="pill">Proposal</span>}
        <span className="pill">{image ? "Single image" : `${words(ad.format)}: build in Ads Manager`}</span>
        <button type="button" onClick={() => setEditing(!editing)} aria-label={editing ? `Done editing ${ad.name}` : `Edit ${ad.name}`} aria-expanded={editing} className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-lime focus-visible:outline-none">
          {editing ? <CheckIcon className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
        </button>
      </div>
      {editing ? (
        <div className="space-y-2 p-3">
          <Input aria-label="Ad name" value={ad.name} onChange={(e) => onChange({ name: e.target.value })} />
          <div>
            <Textarea aria-label="Primary text" rows={4} value={ad.message} onChange={(e) => onChange({ message: e.target.value })} placeholder="Primary text" />
            <Count n={ad.message.length} soft={125} max={2000} />
          </div>
          <div>
            <Input aria-label="Headline" value={ad.headline} onChange={(e) => onChange({ headline: e.target.value })} placeholder="Headline" />
            <Count n={ad.headline.length} soft={40} max={255} />
          </div>
          <Input aria-label="Description" value={ad.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Description (optional)" />
          <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
            <Input aria-label="Landing page" value={ad.link} onChange={(e) => onChange({ link: e.target.value })} placeholder="Landing page" />
            <select aria-label="Call to action" className={fieldClass} value={ad.callToAction} onChange={(e) => onChange({ callToAction: e.target.value as MetaAd["callToAction"] })}>
              {META_CTAS.map((x) => (
                <option key={x} value={x}>
                  {words(x)}
                </option>
              ))}
            </select>
          </div>
          {lead && <Input aria-label="Instant form id" defaultValue={ad.leadFormId ?? ""} onChange={(e) => onChange({ leadFormId: /^\d+$/.test(e.target.value.trim()) ? e.target.value.trim() : null })} placeholder="Instant form id (from Ads Manager)" />}
          {image && <ImageSlot slug={slug} path={ad.imagePath} onChange={(imagePath) => onChange({ imagePath })} />}
          {ad.creativeBrief && !ad.imagePath && <p className="text-xs text-muted-foreground">Creative: {ad.creativeBrief}</p>}
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          {ad.message && <p className="line-clamp-3 px-3 py-2.5 text-[13px] whitespace-pre-line text-body">{ad.message}</p>}
          {image ? <ImageSlot slug={slug} path={ad.imagePath} onChange={(imagePath) => onChange({ imagePath })} flush /> : <p className="border-y px-3 py-6 text-center text-xs text-muted-foreground">{ad.creativeBrief || words(ad.format)}</p>}
          <div className="mt-auto flex items-center gap-3 bg-white/[0.03] px-3 py-2.5">
            <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold text-foreground">{ad.headline || <span className="font-normal text-muted-foreground">No headline</span>}</span>
            <span className="shrink-0 rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-foreground">{words(ad.callToAction)}</span>
          </div>
          {lead && !ad.leadFormId && <p className="px-3 py-1.5 text-xs text-rag-amber">No instant form yet</p>}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Reddit

function RedditEditor({ draft, m, onChange }: { draft: RedditDraft; m: (n: number) => string; onChange: (d: RedditDraft) => void }) {
  const g = draft.adGroup
  const setG = (patch: Partial<RedditDraft["adGroup"]>) => onChange({ ...draft, adGroup: { ...g, ...patch } })
  const setT = (patch: Partial<RedditDraft["adGroup"]["targeting"]>) => setG({ targeting: { ...g.targeting, ...patch } })
  const t = g.targeting
  return (
    <>
      <Section title="Campaign and ad group">
        <dl className="divide-y rounded-md border">
          <Setting label="Campaign name" value={draft.campaign.name}>
            <Input aria-label="Campaign name" value={draft.campaign.name} onChange={(e) => onChange({ ...draft, campaign: { ...draft.campaign, name: e.target.value } })} />
          </Setting>
          <Setting label="Objective" value={words(draft.campaign.objective)}>
            <select aria-label="Objective" className={fieldClass} value={draft.campaign.objective} onChange={(e) => onChange({ ...draft, campaign: { ...draft.campaign, objective: e.target.value as RedditDraft["campaign"]["objective"] } })}>
              {["CLICKS", "CONVERSIONS", "IMPRESSIONS", "LEAD_GENERATION", "BRAND_AWARENESS"].map((o) => (
                <option key={o} value={o}>
                  {words(o)}
                </option>
              ))}
            </select>
          </Setting>
          <Setting label="Ad group" value={g.name}>
            <Input aria-label="Ad group name" value={g.name} onChange={(e) => setG({ name: e.target.value })} />
          </Setting>
          <Setting
            label="Audience"
            value={
              <span className="space-y-0.5">
                <span className="block">{t.geolocations.join(", ") || <span className="text-rag-amber">No location</span>}</span>
                {t.communities.length > 0 && <span className="block text-muted-foreground">Communities: {t.communities.map((c) => `r/${c.replace(/^r\//, "")}`).join(", ")}</span>}
                {t.interests.length > 0 && <span className="block text-muted-foreground">Interests: {t.interests.join(", ")}</span>}
                {t.keywords.length > 0 && <span className="block text-muted-foreground">Keywords: {t.keywords.join(", ")}</span>}
              </span>
            }
          >
            <div className="grid gap-3">
              <Field label="Locations" id="rd-geo">
                <ListInput label="Locations" value={t.geolocations} onChange={(geolocations) => setT({ geolocations })} placeholder="US, GB" upper />
              </Field>
              <Field label="Communities" id="rd-com">
                <ListInput label="Communities" value={t.communities} onChange={(communities) => setT({ communities })} placeholder="msp, sysadmin" />
              </Field>
              <Field label="Interests" id="rd-int">
                <ListInput label="Interests" value={t.interests} onChange={(interests) => setT({ interests })} />
              </Field>
              <Field label="Keywords" id="rd-kw">
                <ListInput label="Keywords" value={t.keywords} onChange={(keywords) => setT({ keywords })} />
              </Field>
            </div>
          </Setting>
          <Setting label="Bidding" value={`${words(g.bidStrategy)} · ${g.bidType}${g.bid ? ` ${m(g.bid)}` : ""}`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <select aria-label="Bid strategy" className={fieldClass} value={g.bidStrategy} onChange={(e) => setG({ bidStrategy: e.target.value as RedditDraft["adGroup"]["bidStrategy"] })}>
                {["MAXIMIZE_VOLUME", "MANUAL_BIDDING", "TARGET_CPX"].map((o) => (
                  <option key={o} value={o}>
                    {words(o)}
                  </option>
                ))}
              </select>
              <select aria-label="Pay per" className={fieldClass} value={g.bidType} onChange={(e) => setG({ bidType: e.target.value as "CPC" | "CPM" })}>
                <option value="CPC">Click (CPC)</option>
                <option value="CPM">1,000 impressions (CPM)</option>
              </select>
              <Input aria-label="Bid" type="number" min={0} step="0.01" value={g.bid ?? ""} onChange={(e) => setG({ bid: e.target.value ? Number(e.target.value) : null })} placeholder="Bid" />
            </div>
          </Setting>
          <Setting
            label="Budget and schedule"
            value={
              <>
                {m(g.dailyBudget)} a day
                <span className="block">
                  {shortDate(g.startDate)} – {g.endDate ? shortDate(g.endDate) : "no end date"}
                </span>
              </>
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Input aria-label="Daily budget" type="number" min={1} value={g.dailyBudget} onChange={(e) => setG({ dailyBudget: Number(e.target.value) })} />
              <Input aria-label="Start" type="date" value={g.startDate} onChange={(e) => setG({ startDate: e.target.value })} />
              <Input aria-label="End" type="date" value={g.endDate ?? ""} onChange={(e) => setG({ endDate: e.target.value || null })} />
            </div>
          </Setting>
        </dl>
      </Section>
      <Section title={`Ads · ${draft.ads.length}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          {draft.ads.map((ad, i) => {
            const set = (patch: Partial<RedditDraft["ads"][number]>) => onChange({ ...draft, ads: draft.ads.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
            return (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Input aria-label="Ad name" value={ad.name} onChange={(e) => set({ name: e.target.value })} />
                  {ad.fromProposal && <span className="pill">Proposal</span>}
                </div>
                {(ad.headline || ad.body) && (
                  <div className="rounded-md bg-white/[0.03] px-3 py-2 text-[13px]">
                    <p className="font-semibold text-foreground">{ad.headline}</p>
                    {ad.body && <p className="mt-1 line-clamp-4 whitespace-pre-line text-body">{ad.body}</p>}
                  </div>
                )}
                {ad.creativeBrief && <p className="text-xs text-muted-foreground">Creative: {ad.creativeBrief}</p>}
                <Input aria-label="Reddit post id" defaultValue={ad.postId ?? ""} onChange={(e) => set({ postId: /^t3_\w+$/.test(e.target.value.trim()) ? e.target.value.trim() : null })} placeholder="Post id once published (t3_…)" className={cn(!ad.postId && "border-rag-amber/60")} />
                <Input aria-label="Landing page" value={ad.clickUrl} onChange={(e) => set({ clickUrl: e.target.value })} placeholder="Landing page" />
              </div>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">Reddit ads run posts that already exist on the client&apos;s profile: publish each post, then paste its id.</p>
      </Section>
      <NotBuilt list={draft.notBuilt} where="Reddit Ads" />
    </>
  )
}
