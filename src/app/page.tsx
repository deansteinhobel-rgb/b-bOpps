import { redirect } from "next/navigation"
import { getProfile } from "@/lib/auth"

/** Opens where the person chose in Options (all clients, or one client). */
export default async function Home() {
  const me = await getProfile()
  const start = me.preferences?.start_page
  redirect(start && start !== "clients" && /^[a-z0-9-]+$/.test(start) ? `/clients/${start}` : "/clients")
}
