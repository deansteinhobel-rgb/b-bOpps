import { redirect } from "next/navigation"
import { getProfile } from "@/lib/auth"

/** /profile opens your own profile page. */
export default async function MyProfile() {
  const me = await getProfile()
  redirect(`/people/${me.id}`)
}
