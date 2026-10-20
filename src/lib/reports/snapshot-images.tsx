/* eslint-disable @next/next/no-img-element -- Satori draws plain <img>; next/image does not apply to generated pictures */
import "server-only"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { ImageResponse } from "next/og"
import type { ReactNode } from "react"
import { compactMoney, money, percent, whole } from "@/lib/format"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { cprTone, STALE_DAYS, type Tone } from "./weekly-message"
import type { WeekAd, WeeklySnapshot } from "./weekly"

/**
 * The weekly snapshot as two pictures for Slack (Dean, 2026-10-20: "easy to see", like Databox's
 * looped snapshots): the client snapshot (last week's numbers, the main goal, spend this month per
 * platform) and the ad performance board (each platform's 2 best and 2 weakest ads with their images).
 * Drawn on the server with next/og (Satori: flexbox only, every box with children needs display flex).
 * B&B's look: page #1a1a1a, black boxes with a #333 hairline, white titles, lime as the one signal.
 */

const W = 1200
const C = {
  page: "#1a1a1a",
  box: "#000000",
  line: "#333333",
  strong: "#5e6165",
  title: "#ffffff",
  body: "#c7c7c7",
  muted: "#91969c",
  lime: "#e4ff1a",
  track: "#1f1f1f",
}
const TONE: Record<Tone, string> = { green: "#4ade80", amber: "#fbbf24", red: "#f87171" }
const toneColor = (t: Tone | null) => (t ? TONE[t] : C.body)

// --- Fonts and pictures (fetched once per server instance) ---
let fontsP: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" }[]> | null = null
async function fonts() {
  fontsP ??= (async () => {
    // Inter as TTF (Google serves TTF to clients that don't ask for woff2); MADE Avenue for the client's name.
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700", { signal: AbortSignal.timeout(10_000) })).text()
    const urls = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\((https:[^)]+\.ttf)\)/g)].map((m) => ({ weight: Number(m[1]) as 400 | 600 | 700, url: m[2] }))
    const inter = await Promise.all(urls.map(async (u) => ({ name: "Inter", weight: u.weight, style: "normal" as const, data: await (await fetch(u.url)).arrayBuffer() })))
    const made = await madeAvenue()
    return made ? [...inter, { name: "MADE Avenue", weight: 400 as const, style: "normal" as const, data: made }] : inter
  })().catch((e) => {
    fontsP = null
    throw e
  })
  return fontsP
}
async function madeAvenue(): Promise<ArrayBuffer | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  try {
    const res = await fetch(`${base}/storage/v1/object/public/brand/fonts/MADEAvenue-Regular.otf`, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) return await res.arrayBuffer()
  } catch {}
  try {
    const buf = await readFile(path.join(process.cwd(), "public/fonts/MADEAvenue-Regular.otf"))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    return null
  }
}

/** A platform logo as a data URI: from the repo's public folder, else from the app. */
const icons = new Map<string, string>()
async function platformIcon(p: Platform, appUrl: string): Promise<string | null> {
  if (icons.has(p)) return icons.get(p)!
  let buf: Buffer | null = null
  try {
    buf = await readFile(path.join(process.cwd(), "public/platforms", `${p}.png`))
  } catch {
    try {
      const res = await fetch(`${appUrl}/platforms/${p}.png`, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) buf = Buffer.from(await res.arrayBuffer())
    } catch {}
  }
  if (!buf) return null
  const uri = `data:image/png;base64,${buf.toString("base64")}`
  icons.set(p, uri)
  return uri
}

/** Pictures Satori can't fetch itself reliably (signed links, logos) come in as data URIs; a failed fetch is just left out. */
async function asDataUri(url: string | null): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const type = res.headers.get("content-type") ?? ""
    if (!res.ok || !/^image\/(png|jpe?g|gif|webp)/.test(type)) return null
    // Satori can't draw WebP; those are left out rather than failing the picture.
    if (type.includes("webp")) return null
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`
  } catch {
    return null
  }
}

// --- Small pieces ---
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))
const weekday = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))
const monthName = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`))
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

function change(now: number | null, prev: number | null, lowerIsBetter = false): { text: string; color: string } | null {
  if (now === null || prev === null || prev === 0) return null
  const pct = Math.round((now / prev - 1) * 100)
  if (pct === 0) return { text: "Same as the week before", color: C.muted }
  const good = lowerIsBetter ? pct < 0 : pct > 0
  return { text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs the week before`, color: good ? TONE.green : TONE.red }
}

function Box({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: "flex", flexDirection: "column", background: C.box, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, ...style }}>{children}</div>
}

function Header({ s, logo, subtitle }: { s: WeeklySnapshot; logo: string | null; subtitle: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ display: "flex", width: 64, height: 64, borderRadius: 14, background: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {logo ? <img src={logo} width={52} height={52} style={{ objectFit: "contain" }} alt="" /> : <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#000" }}>{s.client.name.slice(0, 2)}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", fontFamily: "MADE Avenue", fontSize: 40, color: C.title, lineHeight: 1.1 }}>{s.client.name}</div>
        <div style={{ display: "flex", fontSize: 20, color: C.muted }}>{subtitle}</div>
      </div>
    </div>
  )
}

function Bar({ ratio, tick, color, height = 10 }: { ratio: number; tick: number | null; color: string; height?: number }) {
  const w = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div style={{ display: "flex", position: "relative", height, borderRadius: height, background: C.track, width: "100%" }}>
      <div style={{ display: "flex", width: `${w}%`, height, borderRadius: height, background: color }} />
      {tick !== null && <div style={{ display: "flex", position: "absolute", left: `${Math.max(0, Math.min(1, tick)) * 100}%`, top: -3, width: 3, height: height + 6, background: "#ffffff", borderRadius: 2 }} />}
    </div>
  )
}

function Footer({ s }: { s: WeeklySnapshot }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, color: C.muted }}>
      <div style={{ display: "flex" }}>Lumaux by Bordeaux &amp; Burgundy</div>
      <div style={{ display: "flex" }}>Data to {day(s.dataThrough)}</div>
    </div>
  )
}

// --- Picture 1: the client snapshot ---
function SnapshotCard({ s, logo, platformIcons }: { s: WeeklySnapshot; logo: string | null; platformIcons: Partial<Record<Platform, string | null>> }) {
  const cur = s.client.currency
  const m = (v: number | null) => money(v, cur)
  const c = (v: number | null) => compactMoney(v, cur)
  const n = s.now
  const tiles = [
    { label: "Spend", value: c(n.spend), sub: change(n.spend, s.prev.spend), color: C.title },
    { label: "Results", value: whole(n.results), sub: change(n.results, s.prev.results), color: C.title },
    { label: "Cost per result", value: m(n.cpr), sub: s.target ? { text: `Target ${m(s.target)}`, color: C.muted } : change(n.cpr, s.prev.cpr, true), color: toneColor(cprTone(n.cpr, s.target)) },
    { label: "Clicks", value: whole(n.clicks), sub: { text: `${percent(n.ctr, 2)} CTR`, color: C.muted }, color: C.title },
  ]
  const mo = s.month
  const pace = mo ? mo.daysElapsed / mo.daysInMonth : null
  const paceWords = (v: number | null) => (v === null ? "" : Math.abs(v) <= 10 ? "On pace" : `${Math.abs(v)}% ${v > 0 ? "over" : "under"} pace`)

  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: "100%", background: C.page, padding: 40, gap: 24, fontFamily: "Inter", color: C.body }}>
      <Header s={s} logo={logo} subtitle={`Weekly snapshot · ${weekday(s.week.from)} ${day(s.week.from)} – ${weekday(s.week.to)} ${day(s.week.to)}`} />

      <div style={{ display: "flex", fontSize: 18, color: C.muted }}>Last week, all platforms</div>
      <div style={{ display: "flex", gap: 16 }}>
        {tiles.map((t) => (
          <Box key={t.label} style={{ flex: 1, gap: 8 }}>
            <div style={{ display: "flex", fontSize: 18, color: C.muted }}>{t.label}</div>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: t.color, lineHeight: 1 }}>{t.value}</div>
            <div style={{ display: "flex", fontSize: 16, color: t.sub?.color ?? C.muted }}>{t.sub?.text ?? " "}</div>
          </Box>
        ))}
      </div>

      {s.goals.map((g) => {
        const ratio = g.value !== null && g.target ? g.value / g.target : 0
        const words = g.value === null ? `Not entered for ${monthName(g.month)} yet` : g.behindPct === null ? "" : Math.abs(g.behindPct) <= 10 ? "On pace" : `${Math.abs(g.behindPct)}% ${g.behindPct > 0 ? "behind" : "ahead of"} pace`
        return (
          <Box key={g.name} style={{ gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: C.title }}>{g.name}</div>
              <div style={{ display: "flex", fontSize: 18, color: C.muted }}>{monthName(g.month)} so far</div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: C.title, lineHeight: 1 }}>{g.value === null ? "–" : whole(g.value)}</div>
              {g.target ? <div style={{ display: "flex", fontSize: 24, color: C.muted }}>of {whole(g.target)}</div> : null}
              <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: toneColor(g.tone), marginLeft: "auto" }}>{words}</div>
            </div>
            {g.target ? <Bar ratio={ratio} tick={pace} color={toneColor(g.tone)} height={12} /> : null}
          </Box>
        )
      })}

      {mo && (
        <Box style={{ gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: C.title }}>Spend in {monthName(mo.month)}</div>
            <div style={{ display: "flex", fontSize: 22, color: C.muted }}>
              <span style={{ color: C.title, fontWeight: 700 }}>{c(mo.spend)}</span>
              {mo.budget ? <span>&nbsp;of {c(mo.budget)}</span> : <span>&nbsp;· no budget set</span>}
            </div>
          </div>
          {mo.platforms.map((p) => (
            <div key={p.platform} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {platformIcons[p.platform] ? <img src={platformIcons[p.platform]!} width={26} height={26} style={{ borderRadius: 5 }} alt="" /> : null}
                <div style={{ display: "flex", fontSize: 20, color: C.title }}>{PLATFORM_LABEL[p.platform]}</div>
                <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: toneColor(p.tone), marginLeft: 12 }}>{p.budget ? paceWords(p.variancePct) : "No budget"}</div>
                <div style={{ display: "flex", fontSize: 20, marginLeft: "auto", color: C.muted }}>
                  <span style={{ color: C.title, fontWeight: 700 }}>{c(p.spend)}</span>
                  {p.budget ? <span>&nbsp;/ {c(p.budget)}</span> : null}
                </div>
              </div>
              <Bar ratio={p.budget ? p.spend / p.budget : 0} tick={p.budget ? pace : null} color={toneColor(p.tone)} />
            </div>
          ))}
        </Box>
      )}

      <Box style={{ padding: 0 }}>
        <div style={{ display: "flex", padding: "14px 24px", fontSize: 16, color: C.muted, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", flex: 2 }}>Last week by platform</div>
          <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>Spend</div>
          <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>Results</div>
          <div style={{ display: "flex", flex: 1.4, justifyContent: "flex-end" }}>Cost per result</div>
          <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>Target</div>
        </div>
        {s.platforms.map((p, i) => (
          <div key={p.platform} style={{ display: "flex", alignItems: "center", padding: "14px 24px", fontSize: 20, color: C.title, borderTop: i ? `1px solid ${C.line}` : "none" }}>
            <div style={{ display: "flex", flex: 2, alignItems: "center", gap: 12 }}>
              {platformIcons[p.platform] ? <img src={platformIcons[p.platform]!} width={24} height={24} style={{ borderRadius: 5 }} alt="" /> : null}
              {PLATFORM_LABEL[p.platform]}
            </div>
            <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>{c(p.now.spend)}</div>
            <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>{whole(p.now.results)}</div>
            <div style={{ display: "flex", flex: 1.4, justifyContent: "flex-end", fontWeight: 700, color: toneColor(cprTone(p.now.cpr, p.target)) }}>{m(p.now.cpr)}</div>
            <div style={{ display: "flex", flex: 1, justifyContent: "flex-end", color: C.muted }}>{p.target ? m(p.target) : "–"}</div>
          </div>
        ))}
      </Box>

      <Footer s={s} />
    </div>
  )
}

function snapshotHeight(s: WeeklySnapshot) {
  return 40 + 64 + 24 + 22 + 24 + 150 + s.goals.length * (24 + 160) + (s.month ? 24 + 90 + s.month.platforms.length * 64 : 0) + 24 + 52 + s.platforms.length * 56 + 24 + 20 + 40
}

// --- Picture 2: the ads ---
type AdPic = WeekAd & { pic: string | null; tag: "Best" | "Weakest"; basis: "cost_per_result" | "ctr" }

function AdCard({ a, cur }: { a: AdPic; cur: string }) {
  const m = (v: number | null) => money(v, cur)
  const good = a.tag === "Best"
  const main = a.basis === "ctr" ? `${percent(a.ctr, 2)} CTR` : a.results ? `${whole(a.results)} ${a.results === 1 ? "result" : "results"}` : "No results"
  const sub = a.basis === "ctr" ? `${m(a.spend)} spent` : a.results ? `${m(a.cpr)} each · ${m(a.spend)} spent` : `${m(a.spend)} spent`
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 258, background: C.box, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", width: 258, height: 200, background: "#111111", alignItems: "center", justifyContent: "center", position: "relative" }}>
        {a.pic ? (
          <img src={a.pic} width={258} height={200} style={{ objectFit: "contain" }} alt="" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", padding: 18, gap: 6, width: 258 }}>
            <div style={{ display: "flex", fontSize: 13, color: C.muted }}>{a.kind ?? "No image"}</div>
            <div style={{ display: "flex", fontSize: 17, color: "#8ab4f8", lineHeight: 1.3 }}>{clip(a.name, 70)}</div>
          </div>
        )}
        <div style={{ display: "flex", position: "absolute", top: 10, left: 10, padding: "4px 10px", borderRadius: 20, fontSize: 14, fontWeight: 700, background: good ? TONE.green : TONE.red, color: "#000" }}>
          {a.tag}
          {a.basis === "ctr" ? " by CTR" : ""}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: 14, gap: 6 }}>
        <div style={{ display: "flex", fontSize: 15, color: C.body, height: 40, lineHeight: 1.3, overflow: "hidden" }}>{a.pic ? clip(a.name, 58) : (a.campaign ? clip(a.campaign, 58) : " ")}</div>
        <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: good ? TONE.green : a.results || a.basis === "ctr" ? C.title : TONE.red }}>{main}</div>
        <div style={{ display: "flex", fontSize: 14, color: C.muted }}>{sub}</div>
      </div>
    </div>
  )
}

function AdsBoard({ s, logo, ads, platformIcons }: { s: WeeklySnapshot; logo: string | null; ads: Map<Platform, AdPic[]>; platformIcons: Partial<Record<Platform, string | null>> }) {
  const cur = s.client.currency
  const c = (v: number | null) => compactMoney(v, cur)
  const m = (v: number | null) => money(v, cur)
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: "100%", background: C.page, padding: 40, gap: 24, fontFamily: "Inter", color: C.body }}>
      <Header s={s} logo={logo} subtitle={`Ad performance · ${weekday(s.week.from)} ${day(s.week.from)} – ${weekday(s.week.to)} ${day(s.week.to)}`} />
      {s.platforms.map((p) => {
        const list = ads.get(p.platform) ?? []
        return (
          <Box key={p.platform} style={{ gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {platformIcons[p.platform] ? <img src={platformIcons[p.platform]!} width={30} height={30} style={{ borderRadius: 6 }} alt="" /> : null}
              <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: C.title }}>{PLATFORM_LABEL[p.platform]}</div>
              <div style={{ display: "flex", fontSize: 20, color: C.muted, marginLeft: "auto" }}>
                {c(p.now.spend)} · {whole(p.now.results)} results ·&nbsp;<span style={{ color: toneColor(cprTone(p.now.cpr, p.target)), fontWeight: 700 }}>{m(p.now.cpr)}</span>&nbsp;each
              </div>
            </div>
            {list.length ? (
              <div style={{ display: "flex", gap: 16 }}>
                {list.map((a, i) => (
                  <AdCard key={i} a={a} cur={cur} />
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", fontSize: 18, color: C.muted }}>Not enough ads with spend to compare.</div>
            )}
            {p.stale.count ? (
              <div style={{ display: "flex", fontSize: 18, color: TONE.amber }}>
                {p.stale.count} {p.stale.count === 1 ? "ad has" : "ads have"} run {STALE_DAYS}+ days with no results in {STALE_DAYS} days ({c(p.stale.spend30)} spent)
              </div>
            ) : null}
          </Box>
        )
      })}
      <Footer s={s} />
    </div>
  )
}

function adsHeight(s: WeeklySnapshot, ads: Map<Platform, AdPic[]>) {
  // Each platform box: padding 24 + title 34 + gap 18 + the ad cards (326) or a line (26) + the stale line (18 + 26) + padding 24; 24 between boxes.
  return 40 + 70 + s.platforms.reduce((h, p) => h + 24 + 24 + 34 + 18 + ((ads.get(p.platform) ?? []).length ? 330 : 26) + (p.stale.count ? 18 + 26 : 0) + 24, 0) + 24 + 22 + 40
}

const png = async (res: ImageResponse) => Buffer.from(await res.arrayBuffer())

/** Both pictures as PNGs. `appUrl` is where the platform logos come from when the repo's copies aren't there. */
export async function snapshotImages(s: WeeklySnapshot, appUrl: string): Promise<{ snapshot: Buffer; ads: Buffer }> {
  const [f, logo, iconList] = await Promise.all([fonts(), asDataUri(s.client.logoUrl), Promise.all(s.platforms.map(async (p) => [p.platform, await platformIcon(p.platform, appUrl)] as const))])
  const platformIcons = Object.fromEntries(iconList) as Partial<Record<Platform, string | null>>
  for (const p of s.month?.platforms ?? []) platformIcons[p.platform] ??= await platformIcon(p.platform, appUrl)
  const ads = new Map<Platform, AdPic[]>()
  await Promise.all(
    s.platforms.map(async (p) => {
      const list: AdPic[] = [...p.best.map((a) => ({ ...a, tag: "Best" as const, basis: p.bestBasis })), ...p.weak.map((a) => ({ ...a, tag: "Weakest" as const, basis: p.weakBasis }))].map((a) => ({ ...a, pic: null }))
      await Promise.all(list.map(async (a) => (a.pic = await asDataUri(a.image))))
      ads.set(p.platform, list)
    }),
  )
  const [snapshot, adsPng] = await Promise.all([
    png(new ImageResponse(<SnapshotCard s={s} logo={logo} platformIcons={platformIcons} />, { width: W, height: snapshotHeight(s), fonts: f })),
    png(new ImageResponse(<AdsBoard s={s} logo={logo} ads={ads} platformIcons={platformIcons} />, { width: W, height: adsHeight(s, ads), fonts: f })),
  ])
  return { snapshot, ads: adsPng }
}
