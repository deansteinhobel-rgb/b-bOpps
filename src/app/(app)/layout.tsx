import Link from "next/link"
import { AppHeader } from "@/components/app-header"
import { getProfile, isAdmin, ROLE_LABEL } from "@/lib/auth"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await getProfile()
  const name = profile.full_name ?? profile.email

  return (
    <>
      <AppHeader>
        {profile.role && (
          <>
            <Link href="/clients" className="hover:text-lime">
              Clients
            </Link>
            {isAdmin(profile) && (
              <Link href="/admin/clients" className="hover:text-lime">
                Admin
              </Link>
            )}
          </>
        )}
        <span className="hidden text-white/60 sm:inline">
          {name}
          {profile.role && ` · ${ROLE_LABEL[profile.role]}`}
        </span>
        <form action="/auth/signout" method="post">
          <button type="submit" className="hover:text-lime">
            Sign out
          </button>
        </form>
      </AppHeader>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
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
      </main>
    </>
  )
}
