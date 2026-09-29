import type { SupabaseClient } from "@supabase/supabase-js"
import type { Platform } from "@/lib/metrics/types"

/**
 * Change history for a client, in one timeline (Dean, 2026-09-29, for account managers):
 *   team        changes the paid media team logged (sprint change log), with why when given
 *   platform    what the ad platforms themselves record: Google Ads change history and the Meta
 *               activity log (who, what, when), plus changes we detect on LinkedIn (campaign status,
 *               new ads), because LinkedIn's API has no change log
 *   app         what we did through the app: tests going live and being called, insights acted on,
 *               Notion actions and briefs
 * Read through RLS with the user's client.
 */
export type TimelineSource = "team" | "platform" | "app"
export type TimelineEntry = {
  id: string
  at: string // ISO date-time (date only for team logs)
  source: TimelineSource
  platform: Platform | null
  campaign: string | null
  who: string | null
  /** e.g. "Budget", "Campaign", "Ad", "Test", "Insight". */
  kind: string
  title: string
  detail: string | null
  /** Where it came from inside the platform: "Google Ads UI", "Google Ads Editor", "API", "Automated rule"... */
  via?: string | null
  href?: string | null
  /** Many changes at once (usually a tool): shown with a Bulk tag, and can be hidden. */
  bulk?: boolean
  campaigns?: string[]
}

const londonDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso))

const CHANGE_TYPE: Record<string, string> = { budget: "Budget", creative: "Creative", targeting: "Targeting", bidding: "Bidding", landing_page: "Landing page", tracking: "Tracking", structure: "Structure", other: "Change" }

/**
 * `admin` reads only the Notion write log (its RLS shows people their own writes; account managers
 * should see the whole team's). SECURITY: only pass it after the page loaded the client through RLS.
 */
export async function loadTimeline(supabase: SupabaseClient, admin: SupabaseClient, client: { id: string; slug: string }, sinceIso: string): Promise<TimelineEntry[]> {
  const since = sinceIso.slice(0, 10)
  const [{ data: changes }, { data: platform }, { data: tests }, { data: insights }, { data: notion }] = await Promise.all([
    supabase
      .from("sprint_changes")
      .select("id, changed_on, platform, campaign_name, type, description, source, created_at, profiles(full_name, email)")
      .eq("client_id", client.id)
      .eq("status", "logged")
      .gte("changed_on", since)
      .order("changed_on", { ascending: false })
      .limit(500),
    supabase
      .from("platform_changes")
      .select("id, platform, changed_at, actor, via, object_type, operation, campaign_name, object_name, summary, detail, bulk, campaigns, change_count")
      .eq("client_id", client.id)
      .gte("changed_at", sinceIso)
      .order("changed_at", { ascending: false })
      .limit(1500),
    supabase.from("sprint_tests").select("id, title, platform, status, live_on, outcome, updated_at, owner_name, campaign_names, sprints(number)").eq("client_id", client.id).or(`live_on.gte.${since},updated_at.gte.${sinceIso}`),
    supabase.from("insight_actions").select("id, rule, action, items, note, created_at, snapshot, profiles(full_name, email)").eq("client_id", client.id).gte("created_at", sinceIso).in("action", ["done", "briefed", "tested"]),
    admin.from("notion_write_log").select("id, operation, success, dry_run, created_at, payload, profiles(full_name, email)").eq("client_id", client.id).gte("created_at", sinceIso),
  ])
  const person = (p: unknown) => {
    const x = p as { full_name: string | null; email: string } | null
    return x ? (x.full_name ?? x.email) : null
  }
  const out: TimelineEntry[] = []

  for (const c of changes ?? []) {
    out.push({
      id: `team:${c.id}`,
      at: `${c.changed_on}T12:00:00Z`,
      source: "team",
      platform: (c.platform as Platform) ?? null,
      campaign: c.campaign_name,
      who: person(c.profiles) ?? (c.source === "detected" ? "Logged from a suggestion" : null),
      kind: CHANGE_TYPE[c.type] ?? "Change",
      title: c.description,
      detail: null,
    })
  }
  // A tool can make the same bulk change every hour (e.g. rotating IP exclusions): one line per day,
  // per person, tool and kind of change, instead of dozens.
  const rollup = new Map<string, { first: NonNullable<typeof platform>[number]; runs: number; added: number; removed: number; changed: number; campaigns: Set<string> }>()
  const single: NonNullable<typeof platform> = []
  for (const p of platform ?? []) {
    if (!p.bulk) {
      single.push(p)
      continue
    }
    const k = [londonDay(p.changed_at), p.platform, p.actor, p.via, p.object_type].join("|")
    const r = rollup.get(k) ?? { first: p, runs: 0, added: 0, removed: 0, changed: 0, campaigns: new Set<string>() }
    r.runs++
    if (p.operation === "added") r.added += p.change_count
    else if (p.operation === "removed") r.removed += p.change_count
    else r.changed += p.change_count
    for (const c of p.campaigns ?? []) r.campaigns.add(c)
    if (p.changed_at > r.first.changed_at) r.first = p // show it at the latest time that day
    rollup.set(k, r)
  }
  for (const [k, r] of rollup) {
    const p = r.first
    const parts = [r.added && `${r.added.toLocaleString("en-GB")} added`, r.removed && `${r.removed.toLocaleString("en-GB")} removed`, r.changed && `${r.changed.toLocaleString("en-GB")} changed`].filter(Boolean).join(", ")
    const runs = Math.max(1, Math.round(r.runs / ((r.added ? 1 : 0) + (r.removed ? 1 : 0) + (r.changed ? 1 : 0) || 1)))
    out.push({
      id: `platform-bulk:${k}`,
      at: p.changed_at,
      source: "platform",
      platform: p.platform as Platform,
      campaign: r.campaigns.size === 1 ? [...r.campaigns][0] : null,
      who: p.actor,
      kind: p.object_type ?? "Change",
      title: runs > 1 ? `${p.object_type}s updated in bulk ${runs} times: ${parts}` : `${p.object_type}s updated in bulk: ${parts}`,
      detail: r.campaigns.size > 1 ? `Across ${r.campaigns.size} campaigns` : null,
      via: p.via,
      bulk: true,
      // Campaigns the platform has no name for (drafts, removed) show as "Campaign 123".
      campaigns: [...r.campaigns].map((c) => (/^\d+$/.test(c) ? `Campaign ${c}` : c)),
    })
  }
  for (const p of single) {
    out.push({
      id: `platform:${p.id}`,
      at: p.changed_at,
      source: "platform",
      platform: p.platform as Platform,
      campaign: p.campaign_name,
      who: p.actor,
      kind: p.object_type ?? "Change",
      title: p.summary,
      detail: [p.object_name && p.object_name !== p.campaign_name ? p.object_name : null, p.detail].filter(Boolean).join(" · ") || null,
      via: p.via,
      bulk: Boolean(p.bulk),
      campaigns: (p.campaigns ?? []).map((c: string) => (/^\d+$/.test(c) ? `Campaign ${c}` : c)),
    })
  }
  for (const t of tests ?? []) {
    const n = (t.sprints as unknown as { number: number } | null)?.number
    // Sprint 0 is history imported when the app started: its dates aren't when things happened.
    if (n === 0) continue
    const href = `/clients/${client.slug}/sprint${n ? `?n=${n}` : ""}#test-${t.id}`
    if (t.live_on && t.live_on >= since) {
      out.push({ id: `test-live:${t.id}`, at: `${t.live_on}T12:00:00Z`, source: "app", platform: (t.platform as Platform) ?? null, campaign: (t.campaign_names ?? []).join(", ") || null, who: t.owner_name, kind: "Test", title: `Test went live: ${t.title}`, detail: n ? `Sprint ${n}` : null, href })
    }
    if (t.outcome && t.updated_at >= sinceIso) {
      const word = t.outcome === "carried" ? "carried over" : t.outcome
      out.push({ id: `test-called:${t.id}`, at: t.updated_at, source: "app", platform: (t.platform as Platform) ?? null, campaign: null, who: t.owner_name, kind: "Test", title: `Test ${word}: ${t.title}`, detail: n ? `Sprint ${n}` : null, href })
    }
  }
  for (const a of insights ?? []) {
    const s = (a.snapshot ?? {}) as { title?: string; campaign?: string | null }
    const verb = a.action === "done" ? "Done" : a.action === "briefed" ? "Briefed the team" : "Made a sprint test"
    const count = (a.items ?? []).length
    out.push({
      id: `insight:${a.id}`,
      at: a.created_at,
      source: "app",
      platform: null,
      campaign: s.campaign ?? null,
      who: person(a.profiles),
      kind: "Insight",
      title: `${verb}: ${s.title ?? a.rule}`,
      detail: [count > 1 ? `${count} items` : null, a.note].filter(Boolean).join(" · ") || null,
      href: `/clients/${client.slug}/insights`,
    })
  }
  for (const w of notion ?? []) {
    const props = ((w.payload as { properties?: Record<string, { title?: { text?: { content?: string } }[] }> } | null)?.properties ?? {}) as Record<string, { title?: { text?: { content?: string } }[] }>
    const title = props.Project?.title?.[0]?.text?.content ?? "Notion action"
    out.push({
      id: `notion:${w.id}`,
      at: w.created_at,
      source: "app",
      platform: null,
      campaign: null,
      who: person(w.profiles),
      kind: w.operation === "create_test_brief" ? "Brief" : "Action",
      title: `${w.operation === "create_test_brief" ? "Briefed the team" : "Notion action"}: ${title}`,
      detail: w.dry_run ? "Test mode: not sent to Notion" : w.success === false ? "Failed to create" : null,
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}
