import type { SupabaseClient } from "@supabase/supabase-js"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"

/**
 * Cost per result targets (Dean, 2026-10-15). Each client has one target (clients.monthly_kpi_target),
 * and each ad account may set its own (client_platform_accounts.kpi_target), e.g. Filevine LinkedIn
 * $550 and Meta $450. Anything judged for one platform or campaign uses that platform's target; the
 * all-platforms view keeps the client target. Plain module: server and client code both use it.
 */
export type Targets = { client: number | null; platforms: Partial<Record<Platform, number>> }

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))

/** Builds the targets from the client's target and its account rows (only active accounts count; if two disagree, the lowest wins). */
export function targetsFrom(clientTarget: unknown, accounts: { platform: string; kpi_target?: unknown; active?: boolean | null }[]): Targets {
  const platforms: Partial<Record<Platform, number>> = {}
  for (const a of accounts) {
    const t = num(a.kpi_target)
    if (a.active === false || t === null || !(t > 0)) continue
    const p = a.platform as Platform
    platforms[p] = Math.min(platforms[p] ?? Infinity, t)
  }
  return { client: num(clientTarget), platforms }
}

/** The target for one platform (its own, else the client's). No platform = the client target. */
export function targetFor(t: Targets, platform: Platform | null | undefined): number | null {
  return (platform && t.platforms[platform]) || t.client
}

export const hasPlatformTargets = (t: Targets) => Object.keys(t.platforms).length > 0

/** One line for prompts and notes: "$507 per result (LinkedIn $550, Meta $450)". */
export function describeTargets(t: Targets, money: (v: number) => string, none = "not set") {
  const own = (Object.entries(t.platforms) as [Platform, number][]).map(([p, v]) => `${PLATFORM_LABEL[p]} ${money(v)}`)
  if (!own.length) return t.client === null ? none : money(t.client)
  return `${t.client === null ? "no overall target" : `${money(t.client)} overall`}; by platform: ${own.join(", ")}${t.client === null ? "" : " (other platforms use the overall target)"}`
}

/** Reads a client's targets (the caller has already checked the user can see this client). */
export async function loadTargets(db: SupabaseClient, clientId: string, clientTarget?: unknown): Promise<Targets> {
  const [{ data: client }, { data: accounts }] = await Promise.all([
    clientTarget === undefined ? db.from("clients").select("monthly_kpi_target").eq("id", clientId).single() : Promise.resolve({ data: { monthly_kpi_target: clientTarget } }),
    db.from("client_platform_accounts").select("platform, kpi_target, active").eq("client_id", clientId),
  ])
  return targetsFrom(client?.monthly_kpi_target ?? null, accounts ?? [])
}
