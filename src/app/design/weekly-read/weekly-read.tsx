"use client"

// Prototype of the weekly read (Dean, 2026-10-21: "easy to digest", after ZenABM's reports). Sample data
// only; see sample.ts. The order is the point: verdict, then what's working / needs attention / where to
// act, then the numbers, then the evidence, each list showing its top 5.
import { createContext, useContext, useState } from "react"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  Download,
  FileText,
  Flag,
  Image as ImageIcon,
  Lock,
  Repeat,
  RefreshCw,
  Search,
  Send,
  Split,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserRound,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { AdThumb } from "@/components/ad-thumb"
import { ClientLogo, PlatformIcon, PlatformLabel } from "@/components/brand"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { Sparkline } from "@/app/(app)/clients/[slug]/reporting/charts"
import type { Platform } from "@/lib/metrics/types"
import type { Preview } from "@/lib/previews"
import { cn } from "@/lib/utils"
import { abx, abxAds, formats, overall, platformRows, prioritize, titles, topAds, watch, WEEK, type AccountRow, type Flag as FlagRow, type IconKey, type ReadItem, type Tile, type Tone, type WeeklyRead } from "./sample"

type View = "overall" | "abx"

const ICON: Record<IconKey, LucideIcon> = {
  doc: FileText,
  image: ImageIcon,
  search: Search,
  wallet: Wallet,
  repeat: Repeat,
  users: Users,
  building: Building2,
  target: Target,
  bolt: Zap,
  "trend-up": TrendingUp,
  "trend-down": TrendingDown,
  title: UserRound,
  refresh: RefreshCw,
  split: Split,
}

const TONE_TEXT: Record<Tone, string> = { good: "text-rag-green", bad: "text-rag-red", neutral: "text-muted-foreground" }
const usd = (n: number, cents = false) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 })

// Previews by sample slot ("doc-1", "meta-2"…), so anything that names an ad can show it.
const Previews = createContext<Record<string, Preview>>({})

/** The ad's thumbnail, with the large preview on hover (AdThumb), wherever a specific ad is named. */
function Ad({ slot, alt, className }: { slot: string; alt: string; className?: string }) {
  const p = useContext(Previews)[slot]
  return <AdThumb preview={p} alt={alt} size="sm" className={className} />
}

function AdStrip({ slots, alt }: { slots: string[]; alt: string }) {
  return (
    <div className="mt-2 flex gap-1.5">
      {slots.map((s, i) => (
        <Ad key={s} slot={s} alt={`${alt} (${i + 1})`} className="size-11" />
      ))}
    </div>
  )
}

export function WeeklyReadPrototype({ client, logoUrl, previews }: { client: string; logoUrl: string | null; previews: Record<string, Preview> }) {
  const [view, setView] = useState<View>("overall")
  const read = view === "overall" ? overall : abx

  return (
    <Previews.Provider value={previews}>
    <div className="space-y-6 pb-28">
      {/* Header: which client, which week, which view. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ClientLogo name={client} logoUrl={logoUrl} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill pill-active">{WEEK.label}</span>
              <span className="text-[13px] text-muted-foreground">
                {WEEK.dates} · against {WEEK.vs}
              </span>
              <span className="pill text-muted-foreground">Sample data</span>
            </div>
            <h1 className="mt-1 text-[28px] leading-9">{client} weekly read</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ViewSwitch value={view} onChange={setView} />
          <Button variant="outline" size="sm">
            <Send aria-hidden /> Share
          </Button>
        </div>
      </div>

      <Verdict read={read} />
      <ThreeColumns read={read} />
      <Tiles tiles={read.tiles} />

      {view === "overall" ? <OverallEvidence /> : <AbxEvidence />}

      <Flags green={read.green} red={read.red} />

      {view === "abx" && <CrmTeaser />}

      <p className="pt-2 text-center text-[13px] text-muted-foreground">
        Something missing or wrong in this read?{" "}
        <button className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">Tell us</button>
      </p>

      <AskBar view={view} />
    </div>
    </Previews.Provider>
  )
}

function ViewSwitch({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opts: { v: View; label: string; hint: string }[] = [
    { v: "overall", label: "Overall", hint: "Every platform, judged on results and cost per result" },
    { v: "abx", label: "ABX", hint: "Named target accounts on LinkedIn" },
  ]
  return (
    <div role="radiogroup" aria-label="View" className="inline-flex h-8 items-center rounded-full border border-border bg-black p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          title={o.hint}
          onClick={() => onChange(o.v)}
          className={cn("h-full rounded-full px-3.5 text-[13px] font-medium transition-colors", value === o.v ? "bg-lime text-ink" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The week in one sentence, with the numbers behind it and an 8-week trend. */
function Verdict({ read }: { read: WeeklyRead }) {
  const { verdict } = read
  const Arrow = verdict.tone === "bad" ? ArrowDownRight : ArrowUpRight
  const max = Math.max(...verdict.trend)
  return (
    <section className="surface relative overflow-hidden p-6 sm:p-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className={cn("mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full", verdict.tone === "bad" ? "bg-rag-red-bg text-rag-red" : "bg-rag-green-bg text-rag-green")}>
            <Arrow className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-2xl leading-snug sm:text-[28px] sm:leading-9">{verdict.headline}</h2>
            <p className="mt-3 text-sm leading-relaxed text-body">{verdict.body}</p>
          </div>
        </div>
        <figure className="shrink-0" aria-label={verdict.trendLabel}>
          <div className="flex h-20 items-end gap-1.5">
            {verdict.trend.map((v, i) => (
              <div key={i} title={String(v)} className={cn("w-4 rounded-t-sm", i === verdict.trend.length - 1 ? "bg-lime" : "bg-white/15")} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
            ))}
          </div>
          <figcaption className="mt-2 text-xs text-muted-foreground">{verdict.trendLabel}</figcaption>
        </figure>
      </div>
    </section>
  )
}

const COLUMNS = [
  { key: "working", title: "What's working", Icon: Check, head: "text-rag-green", tile: "bg-rag-green-bg text-rag-green" },
  { key: "attention", title: "What needs attention", Icon: TriangleAlert, head: "text-rag-amber", tile: "bg-rag-amber-bg text-rag-amber" },
  { key: "act", title: "Where to act", Icon: Zap, head: "text-lime", tile: "bg-lime/10 text-lime" },
] as const

function ThreeColumns({ read }: { read: WeeklyRead }) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {COLUMNS.map((c) => (
        <div key={c.key} className="surface flex flex-col p-5">
          <h3 className={cn("flex items-center gap-2 text-sm font-semibold", c.head)}>
            <c.Icon className="size-4" aria-hidden />
            {c.title}
          </h3>
          <ul className="mt-4 flex-1 space-y-5">
            {read[c.key].map((item) => (
              <ReadLine key={item.title} item={item} tile={c.tile} primary={c.key === "act"} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function ReadLine({ item, tile, primary }: { item: ReadItem; tile: string; primary: boolean }) {
  const Icon = ICON[item.icon]
  const one = item.ads?.length === 1 ? item.ads[0] : null
  return (
    <li className="flex gap-3">
      {one ? (
        // One named ad: the ad itself leads the line.
        <span className="relative mt-0.5 shrink-0">
          <Ad slot={one} alt={item.title} className="size-12" />
          {item.platform && <PlatformIcon platform={item.platform} className="absolute -right-1 -bottom-1 size-3.5" />}
        </span>
      ) : (
        <span className={cn("relative mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg", tile)}>
          <Icon className="size-4" aria-hidden />
          {item.platform && <PlatformIcon platform={item.platform} className="absolute -right-1 -bottom-1 size-3.5" />}
        </span>
      )}
      <div className="min-w-0">
        <a href="#" className="text-sm font-medium text-foreground underline decoration-border-strong decoration-dotted underline-offset-4 hover:decoration-foreground">
          {item.title}
        </a>
        {item.tag && <div className="mt-0.5 text-xs font-medium text-foreground/80">{item.tag}</div>}
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{item.detail}</p>
        {item.ads && item.ads.length > 1 && <AdStrip slots={item.ads} alt={item.title} />}
        {item.action && (
          <Button variant={primary ? "default" : "outline"} size="xs" className="mt-2">
            {item.action} <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </li>
  )
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="surface p-4">
          <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
            {t.label}
            {t.hint && <Hint>{t.hint}</Hint>}
          </div>
          <div className="mt-1.5 text-2xl font-semibold tabular-nums">{t.now}</div>
          <div className="mt-1 flex items-baseline gap-1.5 text-xs">
            <span className={cn("font-medium tabular-nums", TONE_TEXT[t.tone])}>{t.change}</span>
            <span className="text-muted-foreground">vs {t.before}</span>
          </div>
          <Sparkline values={t.spark} className="mt-3 h-6 w-full" />
        </div>
      ))}
    </section>
  )
}

/** A titled card holding a table or list: Export, and the top 5 until "Show all". */
function Panel({ title, meta, total, shown, expanded, onToggle, children }: { title: string; meta?: React.ReactNode; total?: number; shown?: number; expanded?: boolean; onToggle?: () => void; children: React.ReactNode }) {
  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {meta && <p className="mt-0.5 text-[13px] text-muted-foreground">{meta}</p>}
        </div>
        <Button variant="outline" size="sm">
          <Download aria-hidden /> Export
        </Button>
      </div>
      <div className="mt-4">{children}</div>
      {total !== undefined && shown !== undefined && total > 5 && (
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>
            Showing {shown} of {total}
          </span>
          <button onClick={onToggle} className="inline-flex items-center gap-1 font-medium text-foreground hover:text-lime">
            {expanded ? "Show top 5" : "Show all"}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
        </div>
      )}
    </section>
  )
}

const TH = "px-3 py-2 text-left text-xs font-medium text-muted-foreground first:pl-5 last:pr-5"
const TD = "px-3 py-2.5 tabular-nums first:pl-5 last:pr-5"

function OverallEvidence() {
  const [allAds, setAllAds] = useState(false)
  const ads = allAds ? topAds : topAds.slice(0, 5)
  return (
    <div className="space-y-4">
      <Panel title="By platform" meta="Last week, with this month's budget pacing">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={TH}>Platform</th>
                <th className={cn(TH, "text-right")}>Spend</th>
                <th className={cn(TH, "text-right")}>Results</th>
                <th className={cn(TH, "text-right")}>Cost per result</th>
                <th className={cn(TH, "w-40")}>Month so far</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {platformRows.map((r) => {
                const pct = r.mtd / r.budget
                const ahead = r.mtd / r.expected - 1
                return (
                  <tr key={r.platform}>
                    <td className={TD}>
                      <PlatformLabel platform={r.platform} />
                    </td>
                    <td className={cn(TD, "text-right")}>{usd(r.spend)}</td>
                    <td className={cn(TD, "text-right")}>{r.results}</td>
                    <td className={cn(TD, "text-right")}>
                      <span className={r.cpr <= r.target ? "text-rag-green" : "text-rag-red"}>{usd(r.cpr)}</span>
                      <span className={cn("ml-1.5 text-xs", TONE_TEXT[r.tone])}>{r.change}</span>
                    </td>
                    <td className={TD}>
                      <div className="relative h-1.5 rounded-full bg-white/10">
                        <div className={cn("h-full rounded-full", Math.abs(ahead) <= 0.1 ? "bg-rag-green" : ahead > 0.25 ? "bg-rag-red" : "bg-rag-amber")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                        <div className="absolute -top-1 h-3.5 w-px bg-white" style={{ left: `${(r.expected / r.budget) * 100}%` }} title="Where spend should be today" />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {usd(r.mtd)} of {usd(r.budget)}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Top ads" meta="Ranked by results, then cost per result" total={topAds.length} shown={ads.length} expanded={allAds} onToggle={() => setAllAds((v) => !v)}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={TH}>Ad</th>
                <th className={cn(TH, "text-right")}>Results</th>
                <th className={cn(TH, "text-right")}>Cost per result</th>
                <th className={cn(TH, "text-right")}>CTR</th>
                <th className={cn(TH, "text-right")}>Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ads.map((a) => (
                <tr key={a.name}>
                  <td className={cn(TD, "max-w-md")}>
                    <AdCell slot={a.ad} name={a.name} platform={a.platform} format={a.format} />
                  </td>
                  <td className={cn(TD, "text-right")}>{a.results}</td>
                  <td className={cn(TD, "text-right")}>{a.cpr ? usd(a.cpr) : "—"}</td>
                  <td className={cn(TD, "text-right")}>{a.ctr.toFixed(2)}%</td>
                  <td className={cn(TD, "text-right")}>{usd(a.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function AbxEvidence() {
  const [allPrio, setAllPrio] = useState(false)
  const [allAds, setAllAds] = useState(false)
  const prio = allPrio ? prioritize : prioritize.slice(0, 5)
  const ads = allAds ? abxAds : abxAds.slice(0, 5)
  return (
    <div className="space-y-4">
      <Panel title="Ad formats" meta="ABX campaigns, last week">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={TH}>Format</th>
                <th className={cn(TH, "text-right")}>
                  <span className="inline-flex items-center gap-1">
                    LP CTR <Hint>Landing page clicks divided by impressions: clicks that reached the site, not likes or opens.</Hint>
                  </span>
                </th>
                <th className={cn(TH, "text-right")}>LP CPC</th>
                <th className={cn(TH, "text-right")}>Impressions</th>
                <th className={cn(TH, "text-right")}>Clicks</th>
                <th className={cn(TH, "text-right")}>LP clicks</th>
                <th className={cn(TH, "text-right")}>Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {formats.map((f, i) => (
                <tr key={f.format}>
                  <td className={TD}>
                    <div className="flex items-center gap-3">
                      <span className={cn("pill w-24 justify-center text-xs", i === 0 && "border-lime/40 text-lime")}>{f.format}</span>
                      <div className="flex gap-1">
                        {f.ads.map((s, n) => (
                          <Ad key={s} slot={s} alt={`${f.format} ad ${n + 1}`} className="size-8" />
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className={cn(TD, "text-right")}>{f.lpCtr.toFixed(2)}%</td>
                  <td className={cn(TD, "text-right")}>{f.lpCpc ? usd(f.lpCpc, true) : "—"}</td>
                  <td className={cn(TD, "text-right")}>{f.impressions.toLocaleString("en-US")}</td>
                  <td className={cn(TD, "text-right")}>{f.clicks}</td>
                  <td className={cn(TD, "text-right")}>{f.lpClicks}</td>
                  <td className={cn(TD, "text-right")}>{usd(f.spend, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Top ads" meta="ABX campaigns, ranked by landing page clicks" total={abxAds.length} shown={ads.length} expanded={allAds} onToggle={() => setAllAds((v) => !v)}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={TH}>Ad</th>
                <th className={cn(TH, "text-right")}>LP clicks</th>
                <th className={cn(TH, "text-right")}>LP CTR</th>
                <th className={cn(TH, "text-right")}>LP CPC</th>
                <th className={cn(TH, "text-right")}>Impressions</th>
                <th className={cn(TH, "text-right")}>Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ads.map((a) => (
                <tr key={a.ad}>
                  <td className={cn(TD, "max-w-md")}>
                    <AdCell slot={a.ad} name={a.name} platform="linkedin" format={a.ad.startsWith("doc") ? "Document" : "Single image"} />
                  </td>
                  <td className={cn(TD, "text-right")}>{a.lpClicks}</td>
                  <td className={cn(TD, "text-right")}>{a.lpCtr.toFixed(2)}%</td>
                  <td className={cn(TD, "text-right")}>{a.lpClicks ? usd(a.lpCpc, true) : "—"}</td>
                  <td className={cn(TD, "text-right")}>{a.impressions.toLocaleString("en-US")}</td>
                  <td className={cn(TD, "text-right")}>{usd(a.spend, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Accounts to prioritize" meta="Target accounts clicking most, last 30 days (LinkedIn refreshes this weekly)" total={prioritize.length} shown={prio.length} expanded={allPrio} onToggle={() => setAllPrio((v) => !v)}>
          <ul className="divide-y divide-border border-t border-border">
            {prio.map((a) => (
              <AccountLine key={a.name} a={a} right={<span className="text-[13px] tabular-nums text-muted-foreground"><span className="font-medium text-rag-green">{a.ctr.toFixed(2)}%</span> CTR on {a.impressions}</span>} />
            ))}
          </ul>
        </Panel>

        <Panel title="Accounts to watch" meta="Spend going nowhere, gone quiet, or not on the target list">
          <ul className="divide-y divide-border border-t border-border">
            {watch.map((a) => (
              <AccountLine
                key={a.name}
                a={a}
                sub={a.reason}
                right={
                  <Button variant="outline" size="xs">
                    Add to exclusions
                  </Button>
                }
              />
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Job titles taking spend" meta="Last 30 days. Titles outside the ICP are flagged.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className={TH}>Job title</th>
                <th className={TH}>Targeted</th>
                <th className={cn(TH, "text-right")}>Spend</th>
                <th className={cn(TH, "text-right")}>Clicks</th>
                <th className={cn(TH, "text-right")}>Engagements</th>
                <th className={TH}>Why it&apos;s here</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {titles.map((t) => (
                <tr key={t.title}>
                  <td className={TD}>{t.title}</td>
                  <td className={TD}>{t.inIcp ? <Check className="size-4 text-rag-green" aria-label="Yes" /> : <span className="text-xs font-medium text-rag-red">No</span>}</td>
                  <td className={cn(TD, "text-right")}>{usd(t.spend)}</td>
                  <td className={cn(TD, "text-right")}>{t.clicks}</td>
                  <td className={cn(TD, "text-right")}>{t.engagements}</td>
                  <td className={cn(TD, "text-[13px] text-muted-foreground")}>{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

/** An ad in a table: its preview, then the name with the platform and format under it. */
function AdCell({ slot, name, platform, format }: { slot: string; name: string; platform: Platform; format: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Ad slot={slot} alt={name} className="size-12" />
      <div className="min-w-0">
        <div className="truncate font-medium" title={name}>
          {name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <PlatformIcon platform={platform} className="size-3.5" />
          {format}
        </div>
      </div>
    </div>
  )
}

function AccountLine({ a, sub, right }: { a: AccountRow; sub?: string; right: React.ReactNode }) {
  const max = Math.max(...a.trend, 1)
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <ClientLogo name={a.name} size="md" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{a.name}</div>
        <div className="truncate text-xs text-muted-foreground">{sub ?? `${a.clicks} clicks · ${usd(a.spend)} · ${a.campaigns} campaign${a.campaigns === 1 ? "" : "s"}`}</div>
      </div>
      <div className="hidden h-5 items-end gap-0.5 sm:flex" aria-hidden title="Clicks, last 5 weeks">
        {a.trend.map((v, i) => (
          <span key={i} className="w-1 rounded-sm bg-white/25" style={{ height: `${Math.max(10, (v / max) * 100)}%` }} />
        ))}
      </div>
      <div className="shrink-0">{right}</div>
    </li>
  )
}

/** Green and red flags: one line each, the kind first so the list scans. */
function Flags({ green, red }: { green: FlagRow[]; red: FlagRow[] }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {[
        { title: "Green flags", rows: green, color: "text-rag-green", dot: "bg-rag-green" },
        { title: "Red flags", rows: red, color: "text-rag-red", dot: "bg-rag-red" },
      ].map((f) => (
        <div key={f.title} className="surface p-5">
          <h3 className={cn("flex items-center gap-2 text-sm font-semibold", f.color)}>
            <Flag className="size-4" aria-hidden /> {f.title}
          </h3>
          <ul className="mt-3 space-y-2.5">
            {f.rows.map((r) => (
              <li key={r.kind + r.subject} className={cn("flex gap-2.5 text-sm leading-snug", r.ad && "items-center")}>
                <span className={cn("size-1.5 shrink-0 rounded-full", !r.ad && "mt-1.5", f.dot)} aria-hidden />
                {r.ad && <Ad slot={r.ad} alt={r.subject} className="size-9" />}
                <span className="min-w-0">
                  <span className="text-muted-foreground">{r.kind}: </span>
                  {r.platform && <PlatformIcon platform={r.platform} className="mr-1 -mt-0.5 size-3.5" />}
                  <span className="font-medium">{r.subject}</span>
                  <span className="text-muted-foreground"> — {r.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** What the ABX view gains once a CRM is connected. Shown as a promise, never as empty $0 tiles. */
function CrmTeaser() {
  const items = [
    { title: "Stage movement", detail: "Accounts moving up or back a stage, and clicks with no stage change in 60 days" },
    { title: "Big spend, no deal", detail: "Ad spend per account against open opportunities" },
    { title: "Pipeline per $", detail: "Pipeline created and closed won against ad spend, this quarter vs last" },
  ]
  return (
    <section className="rounded-[var(--radius)] border border-dashed border-border-strong p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="size-4 text-muted-foreground" aria-hidden /> With a CRM connected
        </h3>
        <span className="text-xs text-muted-foreground">HubSpot is next</span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.title}>
            <div className="text-sm font-medium text-body">{i.title}</div>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{i.detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Ask about this report: pinned to the bottom like ZenABM's follow-up box. Not wired up in the prototype. */
function AskBar({ view }: { view: View }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-4 lg:left-60">
      <div className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-full border border-border-strong bg-elevated/95 p-1.5 pl-5 shadow-2xl backdrop-blur">
        <input
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={view === "abx" ? "Ask about these accounts…" : "Ask about this week…"}
          aria-label="Ask about this report"
        />
        <Button size="icon-sm" aria-label="Ask">
          <ArrowUpRight aria-hidden />
        </Button>
      </div>
    </div>
  )
}
