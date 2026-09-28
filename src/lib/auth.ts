import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export type AppRole = "admin" | "gtm_lead" | "am" | "specialist"
export type Profile = { id: string; email: string; full_name: string | null; role: AppRole | null; notion_user_id: string | null }

/** The signed-in user's profile, or a redirect to /login. Cached per request. */
export const getProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) redirect("/login")
  const { data } = await supabase.from("profiles").select("id, email, full_name, role, notion_user_id").eq("id", userId).single()
  if (!data) redirect("/login")
  return data as Profile
})

export const isAdmin = (p: Profile) => p.role === "admin" || p.role === "gtm_lead"

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  gtm_lead: "GTM lead",
  am: "Account manager",
  specialist: "Paid media specialist",
}
