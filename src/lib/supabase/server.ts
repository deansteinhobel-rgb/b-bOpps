import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/** Supabase client acting as the signed-in user. RLS applies. Use in server components and actions. */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options)
        } catch {
          // Called from a server component, where cookies are read-only. The proxy refreshes them.
        }
      },
    },
  })
}
