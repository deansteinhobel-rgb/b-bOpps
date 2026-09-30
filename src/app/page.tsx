import { redirect } from "next/navigation"
import { getProfile } from "@/lib/auth"
import { clientHome, lensOf, newLayout } from "@/lib/lens"

/**
 * Opens where the person chose in Options (all clients, or one client). In the new layout, Hands-on
 * opens on Today instead of all clients, and a chosen client opens on the lens's first tab.
 */
export default async function Home() {
  const me = await getProfile()
  const start = me.preferences?.start_page
  const client = start && start !== "clients" && /^[a-z0-9-]+$/.test(start) ? start : null
  if (!newLayout(me.preferences)) redirect(client ? `/clients/${client}` : "/clients")
  const lens = lensOf(me.preferences, me.role)
  redirect(client ? clientHome(client, lens) : lens === "hands_on" ? "/today" : "/clients")
}
