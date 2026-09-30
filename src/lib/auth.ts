import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export type AppRole = "admin" | "gtm_lead" | "am" | "specialist" | "viewer"
export type Preferences = {
  /** Performance tab period when the URL doesn't say (7, 14, 30 or 90). */
  default_days?: number
  /** Optimise now: Claude's order or the rules' priority. */
  optimise_order?: "claude" | "priority"
  /** Where the app opens: "clients" (all clients) or a client slug. */
  start_page?: string
  /** Background effects and animations (starfield, pours, sliding highlights). */
  animations?: boolean
  /** "new" = the Hands-on / Overview layout; anything else = the classic one (the rollback switch). */
  layout?: "classic" | "new"
  /** Hands-on or Overview (new layout). Unset = from your role (see lensOf). */
  lens?: "hands_on" | "overview"
}
export type Profile = { id: string; email: string; full_name: string | null; role: AppRole | null; notion_user_id: string | null; avatar_url: string | null; preferences: Preferences }

/** The signed-in user's profile, or a redirect to /login. Cached per request. */
export const getProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) redirect("/login")
  const { data } = await supabase.from("profiles").select("id, email, full_name, role, notion_user_id, avatar_url, preferences").eq("id", userId).single()
  if (!data) redirect("/login")
  return data as Profile
})

export const isAdmin = (p: Profile) => p.role === "admin" || p.role === "gtm_lead"
/** Viewers (everyone in B&B's Notion workspace) read every client but change nothing. */
export const VIEW_ONLY = "You have view access. Ask an admin if you need to make changes."
export const canEdit = (p: Profile) => p.role !== null && p.role !== "viewer"

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  gtm_lead: "GTM lead",
  am: "Account manager",
  specialist: "Paid media specialist",
  viewer: "Viewer",
}

/** For server actions that change anything: everyone with a role except viewers. */
export async function requireEditor(): Promise<Profile> {
  const p = await getProfile()
  if (!canEdit(p)) throw new Error("View only")
  return p
}

/** For admin pages and actions: admins and GTM leads only. */
export async function requireAdmin(): Promise<Profile> {
  const p = await getProfile()
  if (!isAdmin(p)) throw new Error("Admins only")
  return p
}
