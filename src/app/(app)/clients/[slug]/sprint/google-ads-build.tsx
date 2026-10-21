"use client"

import { useMemo, useState, useTransition } from "react"
import { fieldClass } from "@/components/field-class"
import { Spinner } from "@/components/loading"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { money } from "@/lib/format"
import type { Campaign } from "@/lib/sprints/board"
import { cn } from "@/lib/utils"
import { DESCRIPTION_MAX, DESCRIPTIONS, HEADLINE_MAX, HEADLINES, MAX_PAUSE, PATH_MAX, proofread, type AdWriteResult } from "@/lib/windsor/google-ads"
import type { LiveAd, LiveCampaign } from "@/lib/windsor/google-ads-live"
import { createGoogleSearchAd, googleCampaignAds, pauseGoogleAds } from "./google-ads-actions"

const blank = (n: number) => Array.from({ length: n }, () => "")
const adLine = (a: LiveAd) => a.textAd?.headlines.slice(0, 3).map((h) => h.text).join(" | ") || `${a.type.toLowerCase().replace(/_/g, " ") || "Ad"} ${a.adId}`

/**
 * "Build in Google Ads" (Dean, 2026-10-15): write a responsive search ad from the test and create it
 * paused, and pause the ads it replaces. Reads the campaign from Google (through Windsor) when opened.
 * Pinning and experiments aren't possible through Windsor, so the dialog says to do them in Google Ads.
 */
export function GoogleAdsBuild(props: { testId: string; campaigns: Campaign[]; defaultCampaignId?: string; currency: string; disabled?: boolean; onDone: (r: { ok: boolean; text: string }) => void }) {
  const [open, setOpen] = useState(false)
  const [campaignId, setCampaignId] = useState(props.defaultCampaignId ?? props.campaigns[0]?.campaign_id ?? "")
  const [data, setData] = useState<{ campaign: LiveCampaign; live: boolean } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<"create" | "pause">("create")
  const [loading, startLoad] = useTransition()

  const load = (id: string) => {
    setCampaignId(id)
    setData(null)
    setLoadError(null)
    if (!id) return
    startLoad(async () => {
      const r = await googleCampaignAds(props.testId, id)
      if (r.ok) setData({ campaign: r.campaign, live: r.live })
      else setLoadError(r.message)
    })
  }
  const openDialog = () => {
    setOpen(true)
    if (!data) load(campaignId)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" disabled={props.disabled} onClick={openDialog}>
        Build in Google Ads
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Build in Google Ads</DialogTitle>
          <DialogDescription>
            New ads are created paused. Pin headlines, set up the experiment and enable the ads in Google Ads: Windsor can&apos;t do those.
          </DialogDescription>
        </DialogHeader>

        {data && !data.live && (
          <p className="flex items-start gap-2 text-xs text-body">
            <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full bg-rag-amber" />
            <span>
              <span className="font-semibold text-foreground">Test mode:</span> changes are logged here and nothing reaches Google Ads.
            </span>
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="g-campaign">Campaign</Label>
          <select id="g-campaign" className={fieldClass} value={campaignId} onChange={(e) => load(e.target.value)}>
            {!props.campaigns.length && <option value="">No Google Ads campaigns with spend</option>}
            {props.campaigns.map((c) => (
              <option key={c.campaign_id} value={c.campaign_id}>
                {c.campaign_name}
              </option>
            ))}
          </select>
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner label="Reading the campaign" className="size-3.5" />
            Reading the campaign from Google Ads…
          </p>
        )}
        {loadError && <p className="text-xs text-rag-red">{loadError}</p>}

        {data && (
          <>
            <Segmented
              label="What to do"
              tone="quiet"
              value={tab}
              onChange={setTab}
              options={[
                { value: "create", label: "New ad" },
                { value: "pause", label: "Pause old ads" },
              ]}
            />
            {tab === "create" ? (
              <CreateAd testId={props.testId} campaign={data.campaign} live={data.live} onDone={props.onDone} />
            ) : (
              <PauseAds testId={props.testId} campaign={data.campaign} live={data.live} currency={props.currency} onDone={props.onDone} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function summary(r: AdWriteResult, what: string) {
  if (!r.ok) return r.error ?? r.writes.find((w) => w.error)?.error ?? "Something went wrong."
  if (!r.live) return `Logged (test mode): ${what}. Nothing was sent to Google Ads.`
  return `Done in Google Ads: ${what}.`
}

function CreateAd({ testId, campaign, live, onDone }: { testId: string; campaign: LiveCampaign; live: boolean; onDone: (r: { ok: boolean; text: string }) => void }) {
  const groups = campaign.adGroups.filter((g) => g.status === "ENABLED")
  const [adGroupId, setAdGroupId] = useState(groups[0]?.id ?? "")
  const [headlines, setHeadlines] = useState(blank(HEADLINES.max))
  const [descriptions, setDescriptions] = useState(blank(DESCRIPTIONS.max))
  const [finalUrl, setFinalUrl] = useState("")
  const [path1, setPath1] = useState("")
  const [path2, setPath2] = useState("")
  const [checked, setChecked] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const searchAds = groups.find((g) => g.id === adGroupId)?.ads.filter((a) => a.textAd) ?? []
  const copy = { headlines, descriptions, finalUrl, path1, path2 }
  const proofs = useMemo(() => proofread({ headlines, descriptions, finalUrl, path1, path2 }), [headlines, descriptions, finalUrl, path1, path2])
  const blocking = proofs.filter((p) => p.blocking)
  const filledHeadlines = headlines.filter((h) => h.trim()).length

  const startFrom = (adId: string) => {
    const t = searchAds.find((a) => a.adId === adId)?.textAd
    if (!t) return
    setHeadlines([...t.headlines.map((h) => h.text), ...blank(HEADLINES.max)].slice(0, HEADLINES.max))
    setDescriptions([...t.descriptions.map((d) => d.text), ...blank(DESCRIPTIONS.max)].slice(0, DESCRIPTIONS.max))
    setFinalUrl(t.finalUrl ?? "")
    setPath1(t.path1 ?? "")
    setPath2(t.path2 ?? "")
    setChecked(false)
  }
  const edit = (list: string[], set: (v: string[]) => void, i: number, v: string) => {
    const next = [...list]
    next[i] = v
    set(next)
    setChecked(false)
  }
  const submit = () =>
    start(async () => {
      const r = await createGoogleSearchAd(testId, { campaignId: campaign.campaignId, adGroupId, ...copy, proofread: true })
      const text = summary(r, "a new ad, paused")
      setResult({ ok: r.ok, text })
      if (r.ok) onDone({ ok: true, text })
    })

  if (!groups.length) return <p className="text-xs text-muted-foreground">No running ad groups with impressions in the last 14 days.</p>
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="g-group">Ad group</Label>
          <select id="g-group" className={fieldClass} value={adGroupId} onChange={(e) => setAdGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.ads.length} ads)
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-from">Start from an existing ad</Label>
          <select id="g-from" className={fieldClass} value="" onChange={(e) => startFrom(e.target.value)} disabled={!searchAds.length}>
            <option value="">{searchAds.length ? "Copy an ad's lines…" : "No search ads to copy"}</option>
            {searchAds.map((a) => (
              <option key={a.adId} value={a.adId}>
                {adLine(a)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-foreground">
          Headlines <span className="font-normal text-muted-foreground">({filledHeadlines} of {HEADLINES.min}–{HEADLINES.max})</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {headlines.map((h, i) => (
            <Counted key={i} label={`Headline ${i + 1}`} value={h} max={HEADLINE_MAX} onChange={(v) => edit(headlines, setHeadlines, i, v)} />
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-foreground">Descriptions</legend>
        <div className="grid gap-2">
          {descriptions.map((d, i) => (
            <Counted key={i} label={`Description ${i + 1}`} value={d} max={DESCRIPTION_MAX} onChange={(v) => edit(descriptions, setDescriptions, i, v)} />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="g-url">Final URL</Label>
          <Input id="g-url" value={finalUrl} onChange={(e) => (setFinalUrl(e.target.value), setChecked(false))} placeholder="https://" />
        </div>
        <Counted label="Path 1" value={path1} max={PATH_MAX} onChange={(v) => (setPath1(v), setChecked(false))} showLabel />
        <Counted label="Path 2" value={path2} max={PATH_MAX} onChange={(v) => (setPath2(v), setChecked(false))} showLabel />
      </div>

      {proofs.length > 0 && (
        <ul className="space-y-1 rounded-lg border p-3 text-xs">
          {proofs.map((p, i) => (
            <li key={i} className={p.blocking ? "text-rag-red" : "text-rag-amber"}>
              <span className="font-medium">{p.where}:</span> {p.problem}
              {p.line && <span className="text-muted-foreground"> “{p.line}”</span>}
            </li>
          ))}
        </ul>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-3.5 accent-lime" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        I&apos;ve proofread every line, the numbers and the link. Typos in live ads have cost us thousands before.
      </label>

      {result && <p className={cn("text-xs", result.ok ? "text-rag-green" : "text-rag-red")} role="status">{result.text}</p>}
      <div className="flex justify-end">
        <Button size="sm" disabled={pending || !checked || blocking.length > 0 || !adGroupId} onClick={submit}>
          {pending ? "Creating…" : live ? "Create the ad, paused" : "Log it (test mode)"}
        </Button>
      </div>
    </div>
  )
}

function Counted({ label, value, max, onChange, showLabel }: { label: string; value: string; max: number; onChange: (v: string) => void; showLabel?: boolean }) {
  const n = value.replace(/\s+/g, " ").trim().length
  return (
    <div className="space-y-1.5">
      {showLabel && <Label>{label}</Label>}
      <div className="relative">
        <Input aria-label={label} placeholder={showLabel ? undefined : label} value={value} onChange={(e) => onChange(e.target.value)} className="pr-12" />
        <span className={cn("pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] tabular-nums", n > max ? "text-rag-red" : "text-muted-foreground")}>
          {n}/{max}
        </span>
      </div>
    </div>
  )
}

function PauseAds({ testId, campaign, live, currency, onDone }: { testId: string; campaign: LiveCampaign; live: boolean; currency: string; onDone: (r: { ok: boolean; text: string }) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const groups = campaign.adGroups.map((g) => ({ ...g, ads: g.ads.filter((a) => a.status === "ENABLED") })).filter((g) => g.ads.length)
  const key = (g: string, a: string) => `${g}~${a}`
  const toggle = (k: string) => {
    const next = new Set(picked)
    if (next.has(k)) next.delete(k)
    else if (next.size < MAX_PAUSE) next.add(k)
    setPicked(next)
    setConfirming(false)
  }
  const submit = () =>
    start(async () => {
      const ads = [...picked].map((k) => ({ adGroupId: k.split("~")[0], adId: k.split("~")[1] }))
      const r = await pauseGoogleAds(testId, { campaignId: campaign.campaignId, ads })
      const text = summary(r, `${ads.length} ad${ads.length === 1 ? "" : "s"} paused`)
      setResult({ ok: r.ok, text })
      setConfirming(false)
      if (r.ok) {
        setPicked(new Set())
        onDone({ ok: true, text })
      }
    })

  if (!groups.length) return <p className="text-xs text-muted-foreground">No running ads with impressions in the last 14 days.</p>
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Running ads, last 14 days ({campaign.from.slice(5)} to {campaign.to.slice(5)}). Pausing can be undone in Google Ads; the app never enables or removes ads.
      </p>
      <div className="divide-y rounded-lg border">
        {groups.map((g) => (
          <div key={g.id} className="space-y-1 p-3">
            <p className="text-xs font-medium text-muted-foreground">{g.name}</p>
            {g.ads.map((a) => {
              const k = key(g.id, a.adId)
              const cpr = a.conversions > 0 ? money(a.spend / a.conversions, currency) : "no results"
              const ctr = a.impressions ? `${((a.clicks / a.impressions) * 100).toFixed(1)}% CTR` : ""
              return (
                <label key={k} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-white/[0.03]">
                  <input type="checkbox" className="mt-1 size-3.5 accent-lime" checked={picked.has(k)} onChange={() => toggle(k)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{adLine(a)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {money(a.spend, currency)} · {Math.round(a.conversions * 10) / 10} results · {cpr}
                      {ctr && ` · ${ctr}`}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        ))}
      </div>
      {result && <p className={cn("text-xs", result.ok ? "text-rag-green" : "text-rag-red")} role="status">{result.text}</p>}
      <div className="flex justify-end gap-2">
        {confirming && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        )}
        <Button size="sm" disabled={pending || picked.size === 0} onClick={() => (confirming ? submit() : setConfirming(true))}>
          {pending ? "Pausing…" : confirming ? `Yes, pause ${picked.size} ad${picked.size === 1 ? "" : "s"}${live ? "" : " (test mode)"}` : `Pause ${picked.size || ""} ad${picked.size === 1 ? "" : "s"}`.replace("  ", " ")}
        </Button>
      </div>
    </div>
  )
}
