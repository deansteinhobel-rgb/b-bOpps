import { AppSidebar } from "@/components/app-sidebar"
import { getProfile, isAdmin, ROLE_LABEL } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await getProfile()
  const supabase = await createClient()
  // Sidebar clients: the ones this person can see (RLS), with their logos.
  const { data: clients } = profile.role ? await supabase.from("clients").select("slug, name, logo_url").eq("active", true).order("name") : { data: [] }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <AppSidebar
        clients={clients ?? []}
        name={profile.full_name ?? profile.email}
        roleLabel={profile.role ? ROLE_LABEL[profile.role] : null}
        isAdmin={isAdmin(profile)}
        hasRole={Boolean(profile.role)}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 lg:py-10">
          {profile.role ? (
            children
          ) : (
            <div className="max-w-xl">
              <p className="eyebrow">Access pending</p>
              <h1 className="mt-2 text-3xl">You&apos;re signed in, but don&apos;t have access yet</h1>
              <p className="mt-3 text-muted-foreground">
                An admin needs to give {profile.email} a role and assign you to clients. Ask Dean or Esa, then refresh this page.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
