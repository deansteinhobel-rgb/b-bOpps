import { AppSidebar } from "@/components/app-sidebar"
import { CallReminders } from "@/components/call-followups"
import { Starfield } from "@/components/fx/starfield"
import { AskChat } from "@/components/ask-chat"
import { NewsChat } from "@/components/news-chat"
import { aiConfigured } from "@/lib/ai/claude"
import { canEdit, getProfile, isAdmin, ROLE_LABEL } from "@/lib/auth"
import { remindersFor } from "@/lib/calls/load"
import { lensOf, newLayout } from "@/lib/lens"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await getProfile()
  const supabase = await createClient()
  // Last active (Dean): the database writes at most every 5 minutes.
  await supabase.rpc("touch_last_seen")
  const animations = profile.preferences?.animations !== false
  // Sidebar clients: the ones this person can see (RLS), with their logos.
  const { data: clients } = profile.role ? await supabase.from("clients").select("slug, name, logo_url").eq("active", true).order("name") : { data: [] }
  // Things said on client calls a week ago with no sign of them since, for the clients you work on.
  const reminders = canEdit(profile) ? await remindersFor(supabase, profile.id).catch(() => []) : []

  return (
    <div className={cn("flex min-h-dvh flex-col lg:flex-row", !animations && "reduce-fx")}>
      <a href="#main" className="sr-only rounded-full bg-lime px-4 py-2 text-sm font-medium text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      {animations && <Starfield />}
      <AppSidebar
        clients={clients ?? []}
        name={profile.full_name ?? profile.email}
        profileId={profile.id}
        avatarUrl={profile.avatar_url}
        roleLabel={profile.role ? ROLE_LABEL[profile.role] : null}
        isAdmin={isAdmin(profile)}
        hasRole={Boolean(profile.role)}
        lens={newLayout(profile.preferences) ? lensOf(profile.preferences, profile.role) : null}
      />
      <main id="main" className="min-w-0 flex-1">
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
      {/* One Ask in the new layout (news, and the campaign when you're on one); the news cellar in the classic one. */}
      {profile.role && aiConfigured() && (newLayout(profile.preferences) ? <AskChat aiReady /> : <NewsChat />)}
      {reminders.length > 0 && <CallReminders reminders={reminders} canEdit />}
    </div>
  )
}
