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
import { fetchFrom, readBytes } from "@/lib/windsor/creatives"

/**
 * The weekly snapshot as pictures for Slack (Dean, 2026-10-20: "easy to see", like Databox's looped
 * snapshots): the client snapshot (last week's numbers, the main goal, spend this month per platform)
 * and one picture per platform with its 2 best and 2 weakest ads.
 *
 * Slack shows a picture inside a box about 320px tall, so tall pictures come out tiny (Dean: "make the
 * pictures bigger"). Every picture is 16:9 (1200 x 675), which Slack shows at full width, with text big
 * enough to read there; clicking opens it full size.
 *
 * Drawn on the server with next/og (Satori: flexbox only, every box with children needs display flex).
 * B&B's look: page #1a1a1a, black boxes with a #333 hairline, white titles, lime as the one signal.
 */

const W = 1200
const H = 675
const C = {
  page: "#1a1a1a",
  box: "#000000",
  line: "#333333",
  title: "#ffffff",
  body: "#c7c7c7",
  muted: "#91969c",
  track: "#262626",
}
const TONE: Record<Tone, string> = { green: "#4ade80", amber: "#fbbf24", red: "#f87171" }
const toneColor = (t: Tone | null) => (t ? TONE[t] : C.body)

// --- Fonts and pictures (fetched once per server instance) ---
let fontsP: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" }[]> | null = null
async function fonts() {
  fontsP ??= (async () => {
    // Inter as TTF (Google serves TTF to clients that don't ask for woff2); MADE Avenue for the titles.
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700", { signal: AbortSignal.timeout(10_000) })).text()
    const urls = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\((https:[^)]+\.ttf)\)/g)].map((m) => ({ weight: Number(m[1]) as 400 | 600 | 700, url: m[2] }))
    const inter = await Promise.all(urls.map(async (u) => ({ name: "Inter", weight: u.weight, style: "normal" as const, data: await (await fetch(u.url, { signal: AbortSignal.timeout(10_000) })).arrayBuffer() })))
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

/**
 * Where pictures may come from: our storage (signed ad images, the brand bucket) and the logo hosts
 * the app's CSP allows (`img-src` in src/proxy.ts), through the checked-redirect fetch.
 */
const PICTURE_HOSTS = [new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local").hostname, "google.com", "gstatic.com"]
const MAX_PICTURE_BYTES = 5_000_000

/** Pictures come in as data URIs (signed links, logos); a failed fetch is just left out. */
async function asDataUri(url: string | null): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null
  try {
    const res = await fetchFrom(PICTURE_HOSTS, url, { signal: AbortSignal.timeout(15_000) })
    const type = res.headers.get("content-type") ?? ""
    // Satori can't draw WebP; those are left out rather than failing the picture.
    if (!res.ok || !/^image\/(png|jpe?g|gif)/.test(type)) {
      await res.body?.cancel().catch(() => {})
      return null
    }
    return `data:${type};base64,${Buffer.from(await readBytes(res, MAX_PICTURE_BYTES)).toString("base64")}`
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
  return <div style={{ display: "flex", flexDirection: "column", background: C.box, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22, ...style }}>{children}</div>
}

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: C.page, padding: "30px 40px", gap: 22, fontFamily: "Inter", color: C.body }}>{children}</div>
)

function Header({ s, logo, title, right }: { s: WeeklySnapshot; logo: string | null; title: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", width: 54, height: 54, borderRadius: 12, background: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {logo ? <img src={logo} width={44} height={44} style={{ objectFit: "contain" }} alt="" /> : <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: "#000" }}>{s.client.name.slice(0, 2)}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", fontFamily: "MADE Avenue", fontSize: 34, color: C.title, lineHeight: 1.1 }}>{title}</div>
        <div style={{ display: "flex", fontSize: 20, color: C.muted }}>
          {weekday(s.week.from)} {day(s.week.from)} – {weekday(s.week.to)} {day(s.week.to)}
        </div>
      </div>
      {right ? <div style={{ display: "flex", marginLeft: "auto", alignItems: "center", gap: 12 }}>{right}</div> : null}
    </div>
  )
}

function Bar({ ratio, tick, color, height = 12 }: { ratio: number; tick: number | null; color: string; height?: number }) {
  const w = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div style={{ display: "flex", position: "relative", height, borderRadius: height, background: C.track, width: "100%" }}>
      <div style={{ display: "flex", width: `${w}%`, height, borderRadius: height, background: color }} />
      {tick !== null && <div style={{ display: "flex", position: "absolute", left: `${Math.max(0, Math.min(1, tick)) * 100}%`, top: -4, width: 3, height: height + 8, background: "#ffffff", borderRadius: 2 }} />}
    </div>
  )
}

// --- Picture 1: the client snapshot (last week, the main goal, spend this month) ---
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
  const g = s.goals[0] ?? null

  return (
    <Frame>
      <Header s={s} logo={logo} title={s.client.name} right={<div style={{ display: "flex", fontSize: 18, color: C.muted }}>Last week vs the week before</div>} />
      <div style={{ display: "flex", gap: 20, flex: 1 }}>
        {/* Left: last week, then the main goal */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 552 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {tiles.map((t) => (
              <Box key={t.label} style={{ width: 268, gap: 6, padding: "16px 20px" }}>
                <div style={{ display: "flex", fontSize: 19, color: C.muted }}>{t.label}</div>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: t.color, lineHeight: 1 }}>{t.value}</div>
                <div style={{ display: "flex", fontSize: 16, color: t.sub?.color ?? C.muted }}>{t.sub?.text ?? " "}</div>
              </Box>
            ))}
          </div>
          {g && (
            <Box style={{ gap: 10, padding: "16px 20px", flex: 1, justifyContent: "center" }}>
              <div style={{ display: "flex", fontSize: 19, fontWeight: 600, color: C.title }}>{g.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: C.title, lineHeight: 1 }}>{g.value === null ? "–" : whole(g.value)}</div>
                {g.target ? <div style={{ display: "flex", fontSize: 20, color: C.muted }}>of {whole(g.target)} in {monthName(g.month)}</div> : null}
                <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: toneColor(g.tone), marginLeft: "auto" }}>
                  {g.value === null ? "Not entered yet" : g.behindPct === null ? " " : Math.abs(g.behindPct) <= 10 ? "On pace" : `${Math.abs(g.behindPct)}% ${g.behindPct > 0 ? "behind" : "ahead of"} pace`}
                </div>
              </div>
              {g.target ? <Bar ratio={g.value !== null ? g.value / g.target : 0} tick={pace} color={toneColor(g.tone)} /> : null}
            </Box>
          )}
        </div>
        {/* Right: spend this month by platform, like the Clients card */}
        {mo && (
          <Box style={{ flex: 1, gap: 16, padding: "18px 24px", justifyContent: "space-between" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ display: "flex", fontSize: 21, fontWeight: 600, color: C.title }}>Spend in {monthName(mo.month)}</div>
              <div style={{ display: "flex", fontSize: 21, color: C.muted }}>
                <span style={{ color: C.title, fontWeight: 700 }}>{c(mo.spend)}</span>
                {mo.budget ? <span>&nbsp;of {c(mo.budget)}</span> : null}
              </div>
            </div>
            {mo.platforms.slice(0, 5).map((p) => (
              <div key={p.platform} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {platformIcons[p.platform] ? <img src={platformIcons[p.platform]!} width={26} height={26} style={{ borderRadius: 5 }} alt="" /> : null}
                  <div style={{ display: "flex", fontSize: 20, color: C.title }}>{PLATFORM_LABEL[p.platform]}</div>
                  <div style={{ display: "flex", fontSize: 17, fontWeight: 600, color: toneColor(p.tone), marginLeft: 10 }}>{p.budget ? paceWords(p.variancePct) : "No budget"}</div>
                  <div style={{ display: "flex", fontSize: 20, marginLeft: "auto", color: C.muted }}>
                    <span style={{ color: C.title, fontWeight: 700 }}>{c(p.spend)}</span>
                    {p.budget ? <span>&nbsp;/ {c(p.budget)}</span> : null}
                  </div>
                </div>
                <Bar ratio={p.budget ? p.spend / p.budget : 0} tick={p.budget ? pace : null} color={toneColor(p.tone)} />
              </div>
            ))}
            <div style={{ display: "flex", fontSize: 16, color: C.muted }}>The white tick is where spend should be by {day(mo.through)}</div>
          </Box>
        )}
      </div>
    </Frame>
  )
}

// --- Pictures 2+: one per platform, its best and weakest ads ---
type AdPic = WeekAd & { pic: string | null; tag: "Best" | "Weakest"; basis: "cost_per_result" | "ctr" }

function AdCard({ a, cur }: { a: AdPic; cur: string }) {
  const m = (v: number | null) => money(v, cur)
  const good = a.tag === "Best"
  const main = a.basis === "ctr" ? `${percent(a.ctr, 2)} CTR` : a.results ? `${whole(a.results)} ${a.results === 1 ? "result" : "results"}` : "No results"
  const sub = a.basis === "ctr" ? `${m(a.spend)} spent` : a.results ? `${m(a.cpr)} each · ${m(a.spend)}` : `${m(a.spend)} spent`
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 266, background: C.box, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", width: 266, height: 322, background: "#111111", alignItems: "center", justifyContent: "center", position: "relative" }}>
        {a.pic ? (
          <img src={a.pic} width={266} height={322} style={{ objectFit: "contain" }} alt="" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", padding: 20, gap: 8, width: 266 }}>
            <div style={{ display: "flex", fontSize: 15, color: C.muted }}>{a.kind ?? "No image"}</div>
            <div style={{ display: "flex", fontSize: 21, color: "#8ab4f8", lineHeight: 1.3 }}>{clip(a.name, 60)}</div>
          </div>
        )}
        <div style={{ display: "flex", position: "absolute", top: 10, left: 10, padding: "5px 12px", borderRadius: 20, fontSize: 16, fontWeight: 700, background: good ? TONE.green : TONE.red, color: "#000" }}>
          {a.tag}
          {a.basis === "ctr" ? " by CTR" : ""}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "12px 16px", gap: 4 }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: good ? TONE.green : a.results || a.basis === "ctr" ? C.title : TONE.red }}>{main}</div>
        <div style={{ display: "flex", fontSize: 18, color: C.body }}>{sub}</div>
        <div style={{ display: "flex", fontSize: 15, color: C.muted, height: 20, overflow: "hidden" }}>{clip(a.pic ? a.name : (a.campaign ?? " "), 30)}</div>
      </div>
    </div>
  )
}

function PlatformAds({ s, p, logo, ads, icon }: { s: WeeklySnapshot; p: WeeklySnapshot["platforms"][number]; logo: string | null; ads: AdPic[]; icon: string | null }) {
  const cur = s.client.currency
  const c = (v: number | null) => compactMoney(v, cur)
  const m = (v: number | null) => money(v, cur)
  return (
    <Frame>
      <Header
        s={s}
        logo={logo}
        title={`${PLATFORM_LABEL[p.platform]}: best and weakest ads`}
        right={
          <>
            {icon ? <img src={icon} width={32} height={32} style={{ borderRadius: 7, marginRight: 4 }} alt="" /> : null}
            <div style={{ display: "flex", fontSize: 22, color: C.muted }}>
              {c(p.now.spend)} · {whole(p.now.results)} results ·&nbsp;<span style={{ color: toneColor(cprTone(p.now.cpr, p.target)), fontWeight: 700 }}>{m(p.now.cpr)}</span>&nbsp;each
            </div>
          </>
        }
      />
      {ads.length ? (
        <div style={{ display: "flex", gap: 18 }}>
          {ads.map((a, i) => (
            <AdCard key={i} a={a} cur={cur} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", fontSize: 22, color: C.muted }}>Not enough ads with spend to compare.</div>
      )}
      <div style={{ display: "flex", fontSize: 20, color: p.stale.count ? TONE.amber : C.muted, marginTop: "auto" }}>
        {p.stale.count ? `${p.stale.count} ${p.stale.count === 1 ? "ad has" : "ads have"} run ${STALE_DAYS}+ days with no results in ${STALE_DAYS} days (${c(p.stale.spend30)} spent)` : `No ads running ${STALE_DAYS}+ days without results`}
        {p.target ? <span style={{ color: C.muted }}>&nbsp;· target {m(p.target)} per result</span> : null}
      </div>
    </Frame>
  )
}

const png = async (res: ImageResponse) => Buffer.from(await res.arrayBuffer())

export type SnapshotPictures = { snapshot: Buffer; platforms: { platform: Platform; png: Buffer }[] }

/** The client snapshot plus one picture per platform. `appUrl` is where the platform logos come from when the repo's copies aren't there. */
export async function snapshotImages(s: WeeklySnapshot, appUrl: string): Promise<SnapshotPictures> {
  const [f, logo] = await Promise.all([fonts(), asDataUri(s.client.logoUrl)])
  const platformIcons: Partial<Record<Platform, string | null>> = {}
  for (const p of new Set([...s.platforms.map((x) => x.platform), ...(s.month?.platforms ?? []).map((x) => x.platform)])) platformIcons[p] = await platformIcon(p, appUrl)
  const opts = { width: W, height: H, fonts: f }
  const [snapshot, platforms] = await Promise.all([
    png(new ImageResponse(<SnapshotCard s={s} logo={logo} platformIcons={platformIcons} />, opts)),
    Promise.all(
      s.platforms.map(async (p) => {
        const ads: AdPic[] = [...p.best.map((a) => ({ ...a, tag: "Best" as const, basis: p.bestBasis })), ...p.weak.map((a) => ({ ...a, tag: "Weakest" as const, basis: p.weakBasis }))].map((a) => ({ ...a, pic: null }))
        await Promise.all(ads.map(async (a) => (a.pic = await asDataUri(a.image))))
        return { platform: p.platform, png: await png(new ImageResponse(<PlatformAds s={s} p={p} logo={logo} ads={ads} icon={platformIcons[p.platform] ?? null} />, opts)) }
      }),
    ),
  ])
  return { snapshot, platforms }
}
