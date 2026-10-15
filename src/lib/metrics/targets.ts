import type { SupabaseClient } from "@supabase/supabase-js"
import { PLATFORM_LABEL, type Platform } from "./types"

/**
 * Target cost per result per platform (a plain module: server and client components use it). A platform can
 * have its own target over the client's (`client_platform_accounts.target_cost_per_result`; Reddit for
 * DNSFilter: $650 against the client's $300, Dean 2026-10-15). Platforms without one use the client's.
 */
export type PlatformTargets = Partial<Record<Platform, number>>

export const targetFor = (clientTarget: number | null, targets: PlatformTargets | undefined, platform: Platform | null | undefined): number | null =>
  (platform ? targets?.[platform] : undefined) ?? clientTarget

/** The client's platform targets, read through the caller's client (RLS). */
export async function loadPlatformTargets(supabase: SupabaseClient, clientId: string): Promise<PlatformTargets> {
  const { data } = await supabase.from("client_platform_accounts").select("platform, target_cost_per_result").eq("client_id", clientId).eq("active", true).not("target_cost_per_result", "is", null)
  const out: PlatformTargets = {}
  for (const r of (data ?? []) as { platform: Platform; target_cost_per_result: number | string }[]) out[r.platform] = Number(r.target_cost_per_result)
  return out
}

/** For Claude's prompts: "; platforms with their own target per result: Reddit $650", or "" when none has one. */
export function ownTargets(targets: PlatformTargets, money: (n: number) => string): string {
  const own = (Object.entries(targets) as [Platform, number][]).map(([p, t]) => `${PLATFORM_LABEL[p]} ${money(t)}`)
  return own.length ? `; platforms with their own target per result: ${own.join(", ")}` : ""
}

/** "the $300 target", or "the $300 target ($650 on Reddit)" when a platform has its own. */
export function targetWords(clientTarget: number | null, targets: PlatformTargets, money: (n: number) => string, label: (p: Platform) => string): string {
  const own = (Object.entries(targets) as [Platform, number][]).map(([p, t]) => `${money(t)} on ${label(p)}`)
  if (clientTarget === null) return own.length ? `the target (${own.join(", ")})` : "the target"
  return `the ${money(clientTarget)} target${own.length ? ` (${own.join(", ")})` : ""}`
}
