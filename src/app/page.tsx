import { redirect } from "next/navigation"
import { getProfile } from "@/lib/auth"

/** Opens where the person chose in Options: all clients (the default), Today, or one client. */
export default async function Home() {
  const me = await getProfile()
  const start = me.preferences?.start_page
  if (start === "today") redirect("/today")
  const client = start && start !== "clients" && /^[a-z0-9-]+$/.test(start) ? start : null
  redirect(client ? `/clients/${client}` : "/clients")
}
