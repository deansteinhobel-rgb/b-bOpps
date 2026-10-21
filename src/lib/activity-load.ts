import "server-only"
import type { Db } from "@/lib/supabase/db"
import { type ActivityItem, type ActivitySource, describeChange, describeNotionWrite, describePlatformWrite, HIDDEN_OUTSIDE, hiddenClause } from "./activity"

export type ActivityFilter = { days: number; clientId?: string; profileId?: string; source?: ActivitySource }

const LIMIT = 500

/**
 * Admin → Activity: the four sources merged, newest first. SECURITY: admins only (the page's layout
 * checks), read with the admin client because the Notion and platform write logs show people only
 * their own rows.
 */
export async function loadActivity(admin: Db, f: ActivityFilter): Promise<ActivityItem[]> {
  const since = new Date(Date.now() - f.days * 864e5).toISOString()
  const want = (s: ActivitySource) => !f.source || f.source === s

  const changes = async (): Promise<ActivityItem[]> => {
    let q = admin.from("change_log").select("id, at, client_id, profile_id, table_name, row_id, label, op, changes").gte("at", since).order("at", { ascending: false }).limit(LIMIT)
    if (f.clientId) q = q.eq("client_id", f.clientId)
    if (f.profileId) q = q.eq("profile_id", f.profileId)
    const { data } = await q
    return (data ?? []).map((r) => ({ id: `app:${r.id}`, at: r.at, source: "app", clientId: r.client_id, profileId: r.profile_id, actorName: null, platform: null, tag: null, ...describeChange(r) }))
  }

  const platformWrites = async (): Promise<ActivityItem[]> => {
    let q = admin.from("platform_write_log").select("id, created_at, client_id, profile_id, platform, operation, campaign_id, ad_id, payload, success, dry_run").gte("created_at", since).order("created_at", { ascending: false }).limit(LIMIT)
    if (f.clientId) q = q.eq("client_id", f.clientId)
    if (f.profileId) q = q.eq("profile_id", f.profileId)
    const { data } = await q
    return (data ?? []).map((r) => ({
      id: `platform:${r.id}`,
      at: r.created_at,
      source: "platform",
      clientId: r.client_id,
      profileId: r.profile_id,
      actorName: null,
      platform: r.platform,
      tag: r.dry_run ? "dry run" : r.success === false ? "failed" : null,
      ...describePlatformWrite(r),
    }))
  }

  const notionWrites = async (): Promise<ActivityItem[]> => {
    let q = admin.from("notion_write_log").select("id, created_at, client_id, profile_id, operation, payload, success, dry_run").gte("created_at", since).order("created_at", { ascending: false }).limit(LIMIT)
    if (f.clientId) q = q.eq("client_id", f.clientId)
    if (f.profileId) q = q.eq("profile_id", f.profileId)
    const { data } = await q
    return (data ?? []).map((r) => ({
      id: `notion:${r.id}`,
      at: r.created_at,
      source: "notion",
      clientId: r.client_id,
      profileId: r.profile_id,
      actorName: null,
      platform: null,
      tag: r.dry_run ? "dry run" : r.success === false ? "failed" : null,
      ...describeNotionWrite(r),
    }))
  }

  // Changes made inside the platforms name people by the platform's own login (an email for Google
  // Ads), so a person filter matches their email there.
  const outside = async (): Promise<ActivityItem[]> => {
    let q = admin.from("platform_changes").select("id, changed_at, client_id, platform, actor, via, summary, campaign_name, object_name, bulk, change_count").gte("changed_at", since).order("changed_at", { ascending: false }).limit(LIMIT)
    if (f.clientId) q = q.eq("client_id", f.clientId)
    for (const rule of HIDDEN_OUTSIDE) q = q.or(hiddenClause(rule))
    if (f.profileId) {
      const { data: p } = await admin.from("profiles").select("email").eq("id", f.profileId).single()
      if (!p) return []
      q = q.ilike("actor", p.email)
    }
    const { data } = await q
    return (data ?? []).map((r) => ({
      id: `outside:${r.id}`,
      at: r.changed_at,
      source: "outside",
      clientId: r.client_id,
      profileId: null,
      actorName: r.actor,
      platform: r.platform,
      tag: r.bulk ? "bulk" : null,
      title: r.summary ?? "Changed something",
      details: [r.campaign_name, r.object_name && r.object_name !== r.campaign_name ? r.object_name : null, r.change_count > 1 ? `${r.change_count} changes` : null, r.via ? `via ${r.via}` : null].filter((x): x is string => !!x),
    }))
  }

  const parts = await Promise.all([want("app") ? changes() : [], want("platform") ? platformWrites() : [], want("notion") ? notionWrites() : [], want("outside") ? outside() : []])
  return parts
    .flat()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, LIMIT)
}
