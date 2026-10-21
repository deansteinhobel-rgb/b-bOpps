"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { RefreshCw, Sparkles, XIcon } from "lucide-react"
import { useCallback, useEffect, useState, useTransition } from "react"
import { AdThumb } from "@/components/ad-thumb"
import { PlatformLabel } from "@/components/brand"
import { Hint } from "@/components/hint"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { longDate, money, oneDp } from "@/lib/format"
import type { Preview, PreviewMap } from "@/lib/previews"
import type { SprintTest } from "@/lib/sprints/data"
import { improvement, metricValue, resultsOf, TEST_KINDS, VERDICTS, type TestAd, type TestDetail, type TestKind, type VerdictKind } from "@/lib/sprints/results"
import { ASSETS, METRICS, successLine } from "@/lib/sprints/tests"
import { cn } from "@/lib/utils"
import { setTestSetup } from "./test-actions"

type Read = { verdict: VerdictKind; confidence: string | null; headline: string; points: string[]; next_step: string | null; next_step_kind: string | null; created_at: string }

const TONE = {
  na: { box: "bg-rag-na-bg ring-rag-na/30", text: "text-rag-na", dot: "bg-rag-na" },
  green: { box: "bg-rag-green-bg ring-rag-green/30", text: "text-rag-green", dot: "bg-rag-green" },
  amber: { box: "bg-rag-amber-bg ring-rag-amber/30", text: "text-rag-amber", dot: "bg-rag-amber" },
  red: { box: "bg-rag-red-bg ring-rag-red/30", text: "text-rag-red", dot: "bg-rag-red" },
} as const
const NEXT: Record<string, string> = { keep_running: "Keep running", scale: "Scale it", fix: "Fix something", call_it: "Call it" }

const adPreviewKey = (a: TestAd) => `${a.platform}|${a.external_account_id}|${a.ad_id}`

/** The verdict as a small colored chip (board cards and the panel). */
export function VerdictChip({ kind, className }: { kind: VerdictKind; className?: string }) {
  const v = VERDICTS[kind]
  const t = TONE[v.tone]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1", t.box, t.text, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", t.dot)} />
      {v.label}
    </span>
  )
}

/**
 * A live test's results in a side panel (Dean, 2026-09-30), opened from its card; the URL carries
 * ?test=<id> so it can be shared. Top to bottom: the verdict, Claude's read, the comparisons (test
 * ads, campaign, account), the campaign a day, the ads, and how it's measured.
 */
export function TestPanel(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  test: SprintTest
  detail: TestDetail
  previews: PreviewMap
  currency: string
  editable: boolean
  today: string
  onAddFindings?: () => void
}) {
  const { test: t, detail: d } = props
  const m = (v: number) => money(v, props.currency)
  const def = METRICS[d.metric]
  const fmt = (v: number | null) => (v === null ? "–" : def.unit === "money" ? m(v) : def.unit === "percent" ? `${v.toFixed(2)}%` : oneDp(v))
  const verdictTone = TONE[VERDICTS[d.verdict.kind].tone]
  const dayN = Math.max(1, Math.round((Date.parse(props.today) - Date.parse(d.live.from)) / 864e5) + 1)

  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-150 supports-backdrop-filter:backdrop-blur-xs data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l bg-background text-sm shadow-2xl outline-none duration-200 data-closed:animate-out data-closed:slide-out-to-right data-open:animate-in data-open:slide-in-from-right">
          {/* Header */}
          <header className="flex items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <PlatformLabel platform={t.platform} />
                <span aria-hidden>·</span>
                <span>{TEST_KINDS[d.kind].label}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5 text-rag-green">
                  <span className="size-1.5 animate-pulse rounded-full bg-rag-green motion-reduce:animate-none" aria-hidden />
                  Live · day {dayN}
                </span>
              </div>
              <DialogPrimitive.Title className="text-lg leading-snug font-semibold">{t.title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-muted-foreground">
                Live since {longDate(d.live.from)} · data to {longDate(d.live.to)} · compared with {longDate(d.before.from)} – {longDate(d.before.to)}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <XIcon />
            </DialogPrimitive.Close>
          </header>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {/* Verdict */}
            <section className={cn("rounded-lg p-4 ring-1", verdictTone.box)} aria-label="Verdict">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className={cn("flex items-center gap-2 text-base font-semibold", verdictTone.text)}>
                    <span aria-hidden className={cn("size-2 rounded-full", verdictTone.dot)} />
                    {VERDICTS[d.verdict.kind].label}
                  </p>
                  <p className="text-xs text-foreground/80">{d.verdict.reason}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">{def.label}</p>
                  <p className={cn("text-2xl leading-tight font-semibold tabular-nums", verdictTone.text)}>{fmt(metricValue(d.metric, d.comparisons[0].now))}</p>
                  {d.target !== null && <p className="text-[11px] text-muted-foreground">target {fmt(d.target)}</p>}
                </div>
              </div>
            </section>

            <ClaudeRead testId={t.id} editable={props.editable} />

            {/* Comparisons */}
            <section className="space-y-2" aria-label="Comparisons">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                Is it doing the work?
                <Hint label="How is this compared?">
                  {d.kind === "change"
                    ? "A change to an established campaign: the test ads against the campaign's other ads over the same days, then the campaign against the same number of days before it went live."
                    : "A new campaign: against the target and the platform's other campaigns over the same days."}{" "}
                  The account rows are context: if everything moved, the test probably didn&apos;t cause it.
                </Hint>
              </h3>
              <div className="divide-y rounded-lg border bg-card">
                {d.comparisons.map((c, i) => {
                  const now = metricValue(d.metric, c.now)
                  const then = c.then ? metricValue(d.metric, c.then) : null
                  const imp = improvement(d.metric, now, then)
                  const tone = imp === null ? "text-muted-foreground" : imp >= 0.05 ? "text-rag-green" : imp <= -0.05 ? "text-rag-red" : "text-muted-foreground"
                  return (
                    <div key={c.label} className={cn("grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3", i >= d.comparisons.length - 2 && d.comparisons.length > 2 && "bg-elevated/30")}>
                      <div className="min-w-0">
                        <p className="font-medium">{c.label}</p>
                        <p className="text-[11px] text-muted-foreground">vs {c.against}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">
                          {fmt(now)} <span className="text-xs font-normal text-muted-foreground">vs {fmt(then)}</span>
                        </p>
                        <p className={cn("text-[11px] font-medium", tone)}>{imp === null ? "No comparison" : `${Math.abs(Math.round(imp * 100))}% ${imp >= 0 ? "better" : "worse"}`}</p>
                      </div>
                      <p className="col-span-2 text-[11px] text-muted-foreground tabular-nums">
                        {m(c.now.spend)} spend · {oneDp(resultsOf(c.now))} results · {c.now.clicks.toLocaleString("en-GB")} clicks
                        {c.then && (
                          <>
                            {" "}
                            <span className="text-subtle-foreground">
                              (then {m(c.then.spend)} · {oneDp(resultsOf(c.then))} · {c.then.clicks.toLocaleString("en-GB")})
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* A day */}
            <section className="space-y-3" aria-label="The campaign a day">
              <h3 className="text-sm font-semibold">The test campaigns a day</h3>
              <DayBars label="Spend" data={d.daily.map((x) => ({ date: x.date, v: x.spend }))} liveFrom={d.live.from} format={m} />
              <DayBars label="Results" data={d.daily.map((x) => ({ date: x.date, v: x.results }))} liveFrom={d.live.from} format={oneDp} />
            </section>

            {/* Ads */}
            <section className="space-y-2" aria-label="Ads">
              <h3 className="text-sm font-semibold">
                {d.kind === "change" ? "The test ads" : "Ads in the campaign"} <span className="font-normal text-muted-foreground">({d.testAds.length})</span>
              </h3>
              {d.testAds.length ? (
                <AdList ads={d.testAds} previews={props.previews} metric={d.metric} fmt={fmt} money={m} />
              ) : (
                <p className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
                  No ads started on or after {longDate(d.live.from)} in these campaigns. If the change wasn&apos;t new ads (targeting, bids, a landing page), the campaign rows above are the ones to read. Or pick the test ads below.
                </p>
              )}
              {d.otherAds.length > 0 && (
                <details className="group rounded-lg border">
                  <summary className="cursor-pointer list-none px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground">
                    The campaign&apos;s other ads, same days ({d.otherAds.length}) <span className="group-open:hidden">▸</span>
                    <span className="hidden group-open:inline">▾</span>
                  </summary>
                  <div className="border-t p-2">
                    <AdList ads={d.otherAds} previews={props.previews} metric={d.metric} fmt={fmt} money={m} />
                  </div>
                </details>
              )}
            </section>

            {props.editable && <Setup test={t} detail={d} />}

            {/* What we're testing */}
            <section className="space-y-2 text-xs" aria-label="What we're testing">
              <h3 className="text-sm font-semibold">What we&apos;re testing</h3>
              <dl className="space-y-2 rounded-lg border bg-card p-4">
                {t.hypothesis && <Row k="Hypothesis" v={t.hypothesis} />}
                <Row k="Success" v={successLine(t.success_metric, t.success_target, t.success_text, m)} />
                {t.assets.length > 0 && <Row k="Assets" v={t.assets.map((a) => ASSETS[a] ?? a).join(", ")} />}
                <Row k="Campaigns" v={t.campaign_names.join("; ") || "–"} />
                {t.owner_name && <Row k="Owner" v={t.owner_name} />}
              </dl>
            </section>
          </div>

          {props.editable && props.onAddFindings && (
            <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
              <Button size="sm" onClick={props.onAddFindings}>
                Add findings
              </Button>
            </footer>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="whitespace-pre-line">{v}</dd>
    </div>
  )
}

/** Claude's read: today's, or written now (the team's first open of the day). */
async function requestRead(testId: string, fresh: boolean): Promise<{ read: Read | null; error: string | null }> {
  try {
    const res = await fetch("/api/test-read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ testId, fresh }) })
    const body = (await res.json()) as { read: Read | null; error?: string }
    return { read: body.read, error: body.error ?? null }
  } catch {
    return { read: null, error: "Couldn't reach the server. Try again." }
  }
}

function ClaudeRead({ testId, editable }: { testId: string; editable: boolean }) {
  const [read, setRead] = useState<Read | null>(null)
  // The panel's content only mounts while it's open, so the read is fetched when it opens.
  const [state, setState] = useState<"loading" | "done">("loading")
  const [error, setError] = useState<string | null>(null)
  const apply = useCallback((r: { read: Read | null; error: string | null }) => {
    if (r.read) setRead(r.read)
    setError(r.error)
    setState("done")
  }, [])
  useEffect(() => {
    let alive = true
    requestRead(testId, false).then((r) => alive && apply(r))
    return () => {
      alive = false
    }
  }, [testId, apply])
  const load = (fresh: boolean) => {
    setState("loading")
    setError(null)
    requestRead(testId, fresh).then(apply)
  }

  return (
    <section className="space-y-3 rounded-lg border border-violet/30 bg-violet/5 p-4" aria-label="Claude's read" aria-busy={state === "loading"}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-violet" aria-hidden />
          Claude&apos;s read
        </h3>
        <div className="flex items-center gap-2">
          {read && <VerdictChip kind={read.verdict} />}
          {editable && read && state !== "loading" && (
            <Button size="xs" variant="ghost" onClick={() => load(true)} title="Get a fresh read" className="text-muted-foreground">
              <RefreshCw aria-hidden /> Fresh read
            </Button>
          )}
        </div>
      </div>
      {state === "loading" && !read ? (
        <div className="space-y-2" role="status">
          <p className="text-xs text-muted-foreground">Reading the test, the ads and the account… about 30 seconds.</p>
          <div className="h-2 w-3/4 animate-pulse rounded bg-secondary" />
          <div className="h-2 w-2/3 animate-pulse rounded bg-secondary" />
          <div className="h-2 w-1/2 animate-pulse rounded bg-secondary" />
        </div>
      ) : read ? (
        <div className={cn("space-y-3", state === "loading" && "opacity-60")}>
          <p className="leading-relaxed font-medium">{read.headline}</p>
          <ul className="space-y-1.5 text-xs leading-relaxed text-foreground/85">
            {read.points.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-violet" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {read.next_step && (
            <p className="rounded-lg bg-background/60 px-3 py-2 text-xs ring-1 ring-border">
              <span className="font-semibold">{NEXT[read.next_step_kind ?? ""] ?? "Next"}:</span> {read.next_step}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {read.confidence && <>Confidence {read.confidence} · </>}
            {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(read.created_at))}
          </p>
        </div>
      ) : state === "done" && !error ? (
        <p className="text-xs text-muted-foreground">No read yet. Someone on the client&apos;s team gets one when they open the test.</p>
      ) : null}
      {error && <p className="text-xs text-rag-red">{error}</p>}
    </section>
  )
}

/** A day's value as bars, the days before the test muted, a marker where it went live. */
function DayBars({ label, data, liveFrom, format }: { label: string; data: { date: string; v: number }[]; liveFrom: string; format: (v: number) => string }) {
  const max = Math.max(1, ...data.map((x) => x.v))
  const liveIdx = data.findIndex((x) => x.date >= liveFrom)
  const before = data.slice(0, Math.max(0, liveIdx)).reduce((a, x) => a + x.v, 0)
  const after = data.slice(Math.max(0, liveIdx)).reduce((a, x) => a + x.v, 0)
  const w = 100 / Math.max(1, data.length)
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>{label} a day</span>
        <span className="tabular-nums">
          before {format(before)} · since live <span className="text-foreground">{format(after)}</span>
        </span>
      </div>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-16 w-full" role="img" aria-label={`${label} a day, before and since the test went live`}>
        {data.map((x, i) => {
          const h = (x.v / max) * 30
          return (
            <rect key={x.date} x={i * w + w * 0.15} y={32 - h} width={w * 0.7} height={Math.max(h, x.v > 0 ? 0.6 : 0)} className={i >= liveIdx && liveIdx >= 0 ? "fill-lime" : "fill-muted-foreground/35"}>
              <title>{`${longDate(x.date)}: ${format(x.v)}`}</title>
            </rect>
          )
        })}
        {liveIdx > 0 && <line x1={liveIdx * w} x2={liveIdx * w} y1={0} y2={32} className="stroke-foreground/60" strokeWidth={0.4} strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="flex justify-between text-[10px] text-subtle-foreground">
        <span>{data[0] && longDate(data[0].date)}</span>
        {liveIdx > 0 && <span className="text-foreground/70">went live {longDate(liveFrom)}</span>}
        <span>{data.at(-1) && longDate(data.at(-1)!.date)}</span>
      </div>
    </div>
  )
}

function AdList({ ads, previews, metric, fmt, money: m }: { ads: TestAd[]; previews: PreviewMap; metric: string; fmt: (v: number | null) => string; money: (v: number) => string }) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {ads.map((a) => (
        <li key={adPreviewKey(a)} className="flex items-center gap-3 px-3 py-2.5">
          <AdThumb preview={previews[adPreviewKey(a)] as Preview | undefined} alt={a.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium" title={a.name}>
              {a.name}
            </p>
            <p className="text-[11px] text-muted-foreground">first seen {a.first_seen ? longDate(a.first_seen) : "–"}</p>
          </div>
          <div className="text-right text-[11px] tabular-nums">
            <p className="font-semibold">{fmt(metricValue(metric, a.totals))}</p>
            <p className="text-muted-foreground">
              {m(a.totals.spend)} · {oneDp(resultsOf(a.totals))} results
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** How the test is measured: new campaign or a change, and for a change which ads are the test. */
function Setup({ test: t, detail: d }: { test: SprintTest; detail: TestDetail }) {
  const [kind, setKind] = useState<TestKind>(d.kind)
  const allAds = [...d.testAds, ...d.otherAds]
  const [auto, setAuto] = useState(!d.adsPicked)
  const [picked, setPicked] = useState<string[]>(d.testAds.map((a) => a.ad_id))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const changed = kind !== d.kind || d.kindGuessed || (kind === "change" && (auto ? d.adsPicked : !d.adsPicked || [...picked].sort().join() !== d.testAds.map((a) => a.ad_id).sort().join()))
  const save = () =>
    start(async () => {
      const r = await setTestSetup(t.id, { kind, adIds: kind === "change" && !auto ? picked : [] })
      setMsg(r.ok ? "Saved. The numbers update in a moment." : (r.message ?? "Couldn't save that."))
    })
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="How it's measured">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          How it&apos;s measured
          {d.kindGuessed && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-normal text-muted-foreground">worked out by the app</span>}
        </h3>
        <Segmented label="Kind of test" tone="quiet" value={kind} onChange={setKind} options={(Object.keys(TEST_KINDS) as TestKind[]).map((k) => ({ value: k, label: TEST_KINDS[k].label, title: TEST_KINDS[k].hint }))} />
      </div>
      <p className="text-xs text-muted-foreground">{TEST_KINDS[kind].hint}.</p>
      {kind === "change" && allAds.length > 0 && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            The test ads are the ones that started on or after {longDate(d.live.from)}
          </label>
          {!auto && (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
              {allAds.map((a) => (
                <li key={a.ad_id}>
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={picked.includes(a.ad_id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.ad_id] : picked.filter((x) => x !== a.ad_id))} />
                    <span className="min-w-0 flex-1 truncate" title={a.name}>
                      {a.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{a.first_seen ? longDate(a.first_seen) : ""}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={pending || !changed || (kind === "change" && !auto && picked.length === 0)} onClick={save}>
          {d.kindGuessed && kind === d.kind ? "Confirm" : "Save"}
        </Button>
        {msg && (
          <p className="text-xs text-muted-foreground" role="status">
            {msg}
          </p>
        )}
      </div>
    </section>
  )
}
