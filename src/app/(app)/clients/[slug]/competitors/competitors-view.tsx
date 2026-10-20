"use client"
/* eslint-disable @next/next/no-img-element -- signed, short-lived Supabase Storage URLs */

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ExternalLink, Pencil, RefreshCw, X, XIcon } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import { AdThumb } from "@/components/ad-thumb"
import { PlatformIcon } from "@/components/brand"
import { FilterTabs } from "@/components/filter-tabs"
import { SectionHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import type { CompetitorRow, OurLabels } from "@/lib/competitors/load"
import { COMPETITOR_SOURCES, SOURCE_LABEL, type CompetitorSource } from "@/lib/competitors/sources"
import { compareMix, daysAreEstimate, daysLive, firstReads, isNew, SOURCE_PLATFORM, type AdRow } from "@/lib/competitors/view"
import { cn } from "@/lib/utils"
import { readAgain, removeCompetitor, saveCompetitor, type CompetitorInput } from "./actions"

type Show = "new" | "longest" | "all"
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * Reporting › Competitor ads (Dean, 2026-10-20). Live ads from the public Meta, Google and LinkedIn
 * libraries, read every other Sunday: who runs what, what's new this week, what has run longest (a
 * library shows no results, but an ad that keeps running is usually working), and the offer, hook
 * and format mix next to ours. The list of competitors is kept at the bottom.
 */
export function CompetitorsView(props: { slug: string; clientName: string; today: string; canEdit: boolean; competitors: CompetitorRow[]; ads: AdRow[]; lastReadAt: string | null; ourLabels: OurLabels[] }) {
  const { slug, today, ads } = props
  const first = useMemo(() => firstReads(ads), [ads])
  const fresh = (a: AdRow) => isNew(a, today, first)
  // Competitors with live ads first, then the rest by name.
  const competitors = useMemo(() => [...props.competitors].sort((a, b) => Number(!ads.some((x) => x.competitor_id === a.id)) - Number(!ads.some((x) => x.competitor_id === b.id))), [props.competitors, ads])
  const [show, setShow] = useState<Show>(() => (ads.some((a) => isNew(a, today, firstReads(ads))) ? "new" : "longest"))
  const [source, setSource] = useState<"all" | CompetitorSource>("all")
  const [who, setWho] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const names = useMemo(() => new Map(competitors.map((c) => [c.id, c.name])), [competitors])

  const scoped = ads.filter((a) => (!who || a.competitor_id === who) && (source === "all" || a.source === source))
  const newOnes = scoped.filter(fresh)
  const shown = (show === "new" ? newOnes : scoped).slice().sort((a, b) => (show === "new" ? b.first_seen_at.localeCompare(a.first_seen_at) : daysLive(b, today) - daysLive(a, today)))
  const visible = show === "longest" ? shown.slice(0, 24) : shown

  const read = () =>
    start(async () => {
      const r = await readAgain(slug)
      if (!r.ok) toast.error(r.message ?? "Couldn't start the read.")
      else toast.success(r.queued ? `Reading ${r.queued} library pages. New ads show here in a few minutes; refresh the page.` : "Everything on the list was read in the last 2 weeks. The next read is on a Sunday.")
    })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          What {props.clientName}&apos;s competitors are running now, from the public Meta Ad Library, Google Ads Transparency Center and LinkedIn Ad Library, read every other Sunday. The libraries show no results, but an ad that keeps running is usually one that works.
          {props.lastReadAt && <span className="text-subtle-foreground"> Last read {when(props.lastReadAt)}.</span>}
        </p>
        {props.canEdit && (
          <Button size="sm" variant="outline" onClick={read} disabled={pending || !competitors.length}>
            <RefreshCw className={cn(pending && "animate-spin")} /> Read again now
          </Button>
        )}
      </div>

      {competitors.length > 0 && (
        <section className="surface overflow-hidden" aria-label="Competitors">
          <ul className="divide-y">
            {competitors.map((c) => {
              const theirs = ads.filter((a) => a.competitor_id === c.id)
              const longest = theirs.reduce((m, a) => Math.max(m, daysLive(a, today)), 0)
              const newCount = theirs.filter(fresh).length
              const on = who === c.id
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setWho(on ? null : c.id)}
                    aria-pressed={on}
                    className={cn("flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm transition-colors outline-none hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", on && "bg-white/[0.06]")}
                  >
                    <span className={cn("min-w-40 flex-1", on ? "font-medium text-foreground" : "text-body")}>{c.name}</span>
                    {theirs.length ? (
                      <>
                        <span className="flex items-center gap-3">
                          {COMPETITOR_SOURCES.map((s) => {
                            const n = theirs.filter((a) => a.source === s).length
                            return n ? (
                              <span key={s} className="inline-flex items-center gap-1.5 text-[13px] text-body" title={`${n} live on ${SOURCE_LABEL[s]}`}>
                                <PlatformIcon platform={SOURCE_PLATFORM[s]} /> {n}
                              </span>
                            ) : null
                          })}
                        </span>
                        <span className="text-xs text-muted-foreground sm:w-24">{newCount ? <span className="text-lime">{newCount} new</span> : "Nothing new"}</span>
                        <span className="text-xs text-muted-foreground tabular-nums sm:w-28 sm:text-right">Longest {longest} days</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">No live ads found</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {ads.length > 0 ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
            <FilterTabs<Show>
              label="Show"
              showLabel={false}
              value={show}
              onChange={setShow}
              options={[
                { value: "new", label: "New this week", count: newOnes.length },
                { value: "longest", label: "Running longest" },
                { value: "all", label: "All live", count: scoped.length },
              ]}
            />
            <FilterTabs<"all" | CompetitorSource>
              label="Platform"
              showLabel={false}
              value={source}
              onChange={setSource}
              options={[{ value: "all", label: "All platforms" }, ...COMPETITOR_SOURCES.filter((s) => ads.some((a) => a.source === s)).map((s) => ({ value: s, label: <span className="inline-flex items-center gap-1.5"><PlatformIcon platform={SOURCE_PLATFORM[s]} />{SOURCE_LABEL[s]}</span> }))]}
            />
          </div>
          {who && (
            <p className="text-[13px] text-muted-foreground">
              {names.get(who)} only.{" "}
              <button type="button" className="underline hover:text-foreground" onClick={() => setWho(null)}>
                Show every competitor
              </button>
            </p>
          )}
          {visible.length ? (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((a) => (
                <li key={a.id}>
                  <AdCard ad={a} competitor={names.get(a.competitor_id) ?? ""} today={today} isNew={fresh(a)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="surface px-4 py-6 text-sm text-muted-foreground">{show === "new" ? "No new ads since last week. Try Running longest." : "No live ads here."}</p>
          )}
        </section>
      ) : (
        competitors.length > 0 && <p className="surface px-4 py-6 text-sm text-muted-foreground">No live ads yet. The libraries are read every other Sunday{props.canEdit ? "; Read again reads anything new on the list now" : ""}.</p>
      )}

      {ads.length > 0 && <ThemVsUs ads={ads} ours={props.ourLabels} clientName={props.clientName} />}

      <ManageCompetitors slug={slug} competitors={competitors} canEdit={props.canEdit} />
      <AdPanel ads={ads} names={names} today={today} />
    </div>
  )
}

/** One ad: the creative (our copy), who and where, how long it has run, and its labels. Opens the side panel. */
function AdCard({ ad, competitor, today, isNew }: { ad: AdRow; competitor: string; today: string; isNew: boolean }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const open = () => {
    const p = new URLSearchParams(params.toString())
    p.set("ad", ad.id)
    window.history.pushState(null, "", `${pathname}?${p}`)
  }
  const days = daysLive(ad, today)
  return (
    <button type="button" onClick={open} aria-haspopup="dialog" className="group/card flex w-full flex-col gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {ad.src ? (
        <span className="relative block aspect-square w-full overflow-hidden rounded-md border bg-elevated transition-colors group-hover/card:border-foreground/30">
          <img src={ad.src} alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-xl" />
          <img src={ad.src} alt={ad.headline ?? `${competitor} ad`} loading="lazy" className="relative size-full object-contain" />
        </span>
      ) : (
        <span className="flex aspect-square w-full items-center justify-center rounded-md border bg-elevated p-4 text-center text-[13px] text-body transition-colors group-hover/card:border-foreground/30">
          <span className="line-clamp-6">{ad.headline ?? ad.body ?? `${ad.format ? `${ad.format[0].toUpperCase()}${ad.format.slice(1).replace(/_/g, " ")} ad` : "Ad"}, no preview in the library`}</span>
        </span>
      )}
      <span className="flex items-center gap-1.5 text-[13px]">
        <PlatformIcon platform={SOURCE_PLATFORM[ad.source]} />
        <span className="truncate font-medium text-foreground">{competitor}</span>
        {isNew && <span className="pill shrink-0 border-lime/50 text-lime">New</span>}
      </span>
      <span className="text-xs text-muted-foreground">
        Live {daysAreEstimate(ad) ? `${days}+` : days} days{ad.label_offer && ad.label_offer !== "Other" ? ` · ${ad.label_offer}` : ""}
      </span>
      {ad.headline && <span className="line-clamp-2 text-xs text-body">{ad.headline}</span>}
    </button>
  )
}

/** The side panel for one ad (?ad=<id>, shareable; Back closes it). */
function AdPanel({ ads, names, today }: { ads: AdRow[]; names: Map<string, string>; today: string }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const ad = ads.find((a) => a.id === params.get("ad"))
  const close = () => {
    const p = new URLSearchParams(params.toString())
    p.delete("ad")
    const q = p.toString()
    window.history.replaceState(null, "", q ? `${pathname}?${q}` : pathname)
  }
  const labels = ad ? ([["Format", ad.label_format], ["Content", ad.label_content_type], ["Asks people to", ad.label_offer], ["Hook", ad.label_hook], ["Topic", ad.label_topic]] as const).filter(([, v]) => v && v !== "Other") : []
  return (
    <DialogPrimitive.Root open={!!ad} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-150 supports-backdrop-filter:backdrop-blur-xs data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l bg-background text-sm shadow-2xl outline-none duration-200 data-closed:animate-out data-closed:slide-out-to-right data-open:animate-in data-open:slide-in-from-right">
          {ad && (
            <>
              <header className="flex items-start gap-3 border-b px-5 py-4">
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="font-heading text-2xl leading-tight">{names.get(ad.competitor_id)}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                    <PlatformIcon platform={SOURCE_PLATFORM[ad.source]} /> {SOURCE_LABEL[ad.source]} · live {daysAreEstimate(ad) ? `at least ${daysLive(ad, today)}` : daysLive(ad, today)} days
                    {ad.started_on ? ` (since ${ad.started_on.split("-").reverse().join("/")}${ad.version_started_on ? `; this version since ${ad.version_started_on.split("-").reverse().join("/")}` : ""})` : ""} · {ad.countries.join(", ")}
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
                  <XIcon className="size-4" />
                </DialogPrimitive.Close>
              </header>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
                {ad.src && <AdThumb preview={{ src: ad.src, link: ad.library_url, textOnly: false }} alt={ad.headline ?? "Competitor ad"} size="card" className="max-h-[60vh]" />}
                <div className="space-y-2">
                  {ad.headline && <p className="text-base font-semibold text-foreground">{ad.headline}</p>}
                  {ad.body && <p className="whitespace-pre-line text-body">{ad.body}</p>}
                  {(ad.cta || ad.landing_url) && (
                    <p className="text-[13px] text-muted-foreground">
                      {ad.cta && <span className="pill mr-2">{ad.cta}</span>}
                      {ad.landing_url && (
                        <a href={ad.landing_url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                          {ad.landing_url.replace(/^https:\/\//, "")}
                        </a>
                      )}
                    </p>
                  )}
                </div>
                {labels.length > 0 && (
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                    {labels.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="text-body">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {ad.label_summary && <p className="text-[13px] text-muted-foreground">{ad.label_summary}</p>}
                {ad.library_url && (
                  <a href={ad.library_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-body underline hover:text-foreground">
                    Open in the {SOURCE_LABEL[ad.source]} ad library <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Offer, hook and format: the share of competitors' live ads next to the share of ours (spent in the last 30 days). */
function ThemVsUs({ ads, ours, clientName }: { ads: AdRow[]; ours: OurLabels[]; clientName: string }) {
  const labeled = ads.filter((a) => a.label_offer)
  if (!labeled.length) return null
  const groups = [
    { title: "What they ask people to do", rows: compareMix(labeled.map((a) => a.label_offer), ours.map((o) => o.offer)) },
    { title: "The hook", rows: compareMix(labeled.map((a) => a.label_hook), ours.map((o) => o.hook)) },
    { title: "Format", rows: compareMix(labeled.map((a) => a.label_format), ours.map((o) => o.format)) },
  ]
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Them vs us"
        description={
          <>
            Share of competitors&apos; {labeled.length} labeled live ads (<span className="text-pink">pink</span>) next to {clientName}&apos;s {ours.length} ads that spent in the last 30 days (<span className="text-lime">lime</span>).
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.title} className="surface space-y-3 p-4">
            <h3 className="text-sm font-semibold">{g.title}</h3>
            <ul className="space-y-2.5">
              {g.rows.map((r) => (
                <li key={r.value} className="space-y-1">
                  <div className="text-[13px] text-body">{r.value}</div>
                  <Bar share={r.them} cls="bg-pink" label={`Competitors ${pct(r.them)}`} />
                  <Bar share={r.us} cls="bg-lime" label={`${clientName} ${pct(r.us)}`} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function Bar({ share, cls, label }: { share: number; cls: string; label: string }) {
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full", cls)} style={{ width: `${Math.max(share * 100, share ? 2 : 0)}%` }} />
      </div>
      <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{pct(share)}</span>
    </div>
  )
}

const EMPTY: CompetitorInput = { name: "", website: "", metaPageId: "", linkedinAdvertiser: "", googleAdvertiserIds: "", notes: "" }
const toInput = (c: CompetitorRow): CompetitorInput => ({
  name: c.name,
  website: c.website ?? "",
  metaPageId: c.meta_page_id ?? "",
  linkedinAdvertiser: c.linkedin_advertiser ?? "",
  googleAdvertiserIds: c.google_advertiser_ids.join(", "),
  notes: c.notes ?? "",
})

/** The competitor list and where each one is looked up. The team edits it; viewers read it. */
function ManageCompetitors({ slug, competitors, canEdit }: { slug: string; competitors: CompetitorRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const [pending, start] = useTransition()
  const remove = (c: CompetitorRow) =>
    start(async () => {
      const r = await removeCompetitor(slug, c.id)
      if (!r.ok) toast.error(r.message ?? "Couldn't remove it.")
    })
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Competitors"
        description="Where each one is looked up. A library with no id is skipped."
        actions={canEdit && editing !== "new" && <Button size="sm" variant="outline" onClick={() => setEditing("new")}>Add a competitor</Button>}
      />
      <div className="surface overflow-hidden">
        <ul className="divide-y">
          {editing === "new" && (
            <li className="p-4">
              <CompetitorForm slug={slug} id={null} initial={EMPTY} onDone={() => setEditing(null)} />
            </li>
          )}
          {competitors.map((c) =>
            editing === c.id ? (
              <li key={c.id} className="p-4">
                <CompetitorForm slug={slug} id={c.id} initial={toInput(c)} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={c.id} className="group flex flex-wrap items-start gap-x-6 gap-y-1 px-4 py-3 text-[13px]">
                <div className="min-w-40 flex-1">
                  <div className="text-sm text-foreground">{c.name}</div>
                  {c.website && <div className="text-muted-foreground">{c.website}</div>}
                  {c.notes && <div className="mt-1 text-xs text-muted-foreground">{c.notes}</div>}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="inline-flex items-center gap-1.5 text-muted-foreground"><PlatformIcon platform="meta" className="size-3.5" /> Meta</dt>
                  <dd className="font-mono text-body">{c.meta_page_id ?? "–"}</dd>
                  <dt className="inline-flex items-center gap-1.5 text-muted-foreground"><PlatformIcon platform="google_ads" className="size-3.5" /> Google</dt>
                  <dd className="font-mono text-body">{c.google_advertiser_ids.join(", ") || "–"}</dd>
                  <dt className="inline-flex items-center gap-1.5 text-muted-foreground"><PlatformIcon platform="linkedin" className="size-3.5" /> LinkedIn</dt>
                  <dd className="text-body">{c.linkedin_advertiser ?? "–"}</dd>
                </dl>
                {canEdit && (
                  <div className="flex gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => setEditing(c.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Edit ${c.name}`}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button type="button" disabled={pending} onClick={() => remove(c)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Remove ${c.name}`}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
          {!competitors.length && editing !== "new" && <li className="px-4 py-6 text-sm text-muted-foreground">No competitors yet.{canEdit ? " Add the companies you lose deals to." : ""}</li>}
        </ul>
      </div>
    </section>
  )
}

function CompetitorForm({ slug, id, initial, onDone }: { slug: string; id: string | null; initial: CompetitorInput; onDone: () => void }) {
  const [v, setV] = useState(initial)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const save = () =>
    start(async () => {
      const r = await saveCompetitor(slug, id, v)
      if (r.ok) onDone()
      else setMsg(r.message ?? "Couldn't save.")
    })
  const field = (key: keyof CompetitorInput, label: string, hint: string, mono = false) => (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} className={cn("h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:border-foreground/30", mono && "font-mono text-[13px]")} />
      <span className="block text-[11px] text-subtle-foreground">{hint}</span>
    </label>
  )
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Name", "As the team calls them")}
        {field("website", "Website", "e.g. cloudflare.com")}
        {field("metaPageId", "Meta page id", "The view_all_page_id in their Meta Ad Library link", true)}
        {field("googleAdvertiserIds", "Google advertiser ids", "AR… from their Ads Transparency Center link; several with commas", true)}
        {field("linkedinAdvertiser", "LinkedIn advertiser", "The name the LinkedIn Ad Library shows, e.g. Cloudflare")}
        {field("notes", "Notes", "Anything worth knowing, e.g. which product competes with ours")}
      </div>
      {msg && <p className="text-xs text-rag-red">{msg}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending || !v.name.trim()}>
          {id ? "Save" : "Add"}
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

