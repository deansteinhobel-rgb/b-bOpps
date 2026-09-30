"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { setLens } from "@/app/(app)/options/actions"
import { AppMark, Avatar, ClientLogo } from "@/components/brand"
import { Segmented } from "@/components/segmented"
import { clientHome, type Lens } from "@/lib/lens"
import { cn } from "@/lib/utils"

export type SidebarClient = { slug: string; name: string; logo_url: string | null }
/** `lens` is set in the new layout only (null = classic). */
type Props = { clients: SidebarClient[]; name: string; roleLabel: string | null; isAdmin: boolean; hasRole: boolean; profileId: string; avatarUrl: string | null; lens: Lens | null }

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  )
}

const Icon = {
  today: (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5.5l1.5 1.5L8 4.5M4 10.5L5.5 12 8 9.5M4 15.5L5.5 17 8 14.5M11 6h5M11 11h5M11 16h5" />
    </svg>
  ),
  learnings: (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M10 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM8 17h4" strokeLinecap="round" />
    </svg>
  ),
  options: (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M4 6h7M15 6h1M4 14h1M9 14h7" />
      <circle cx="13" cy="6" r="2" />
      <circle cx="7" cy="14" r="2" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M10 2.5l1.6 2.2 2.7-.4.4 2.7 2.2 1.6-1.4 2.4 1.4 2.4-2.2 1.6-.4 2.7-2.7-.4L10 17.5l-1.6-2.2-2.7.4-.4-2.7-2.2-1.6L4.5 9 3.1 6.6l2.2-1.6.4-2.7 2.7.4z" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.3" />
    </svg>
  ),
}

/**
 * Hands-on / Overview (new layout): the same app through two lenses. Saved on your profile, so the
 * home page, the order of the client tabs and where client links open all follow it.
 */
function LensSwitch({ lens }: { lens: Lens }) {
  const router = useRouter()
  const [value, setValue] = useState(lens)
  const [, start] = useTransition()
  return (
    <div className="px-1" title="Hands-on: Today and Do first. Overview: performance and planning first. Everything stays reachable in both.">
      <Segmented
        label="Lens"
        tone="quiet"
        value={value}
        onChange={(v) => {
          setValue(v)
          start(async () => {
            const r = await setLens(v)
            if (!r.ok) {
              setValue(lens)
              return void toast.error(r.message ?? "Couldn't switch.")
            }
            router.refresh()
          })
        }}
        options={[
          { value: "hands_on", label: "Hands-on" },
          { value: "overview", label: "Overview" },
        ]}
      />
    </div>
  )
}

/** The client list (Dean: no separate "Clients" item; the heading links to all clients). */
function NavBody({ clients, hasRole, pathname, lens }: Props & { pathname: string }) {
  if (!hasRole) return null
  return (
    <nav className="space-y-0.5" aria-label="Clients">
      {lens && (
        <div className="mb-4 space-y-3">
          <LensSwitch lens={lens} />
          <NavLink href="/today" active={pathname.startsWith("/today")}>
            {Icon.today} Today
          </NavLink>
        </div>
      )}
      <Link href="/clients" className={cn("block px-2.5 pb-1 text-[10px] tracking-[0.14em] uppercase transition-colors hover:text-foreground", pathname === "/clients" ? "text-foreground" : "text-subtle-foreground")}>
        Clients
      </Link>
      {clients.map((c) => (
        <NavLink key={c.slug} href={lens ? clientHome(c.slug, lens) : `/clients/${c.slug}`} active={pathname.startsWith(`/clients/${c.slug}`)}>
          <ClientLogo name={c.name} logoUrl={c.logo_url} size="xs" />
          <span className="truncate">{c.name}</span>
        </NavLink>
      ))}
    </nav>
  )
}

/** Learnings, Admin and Options sit at the bottom, above the profile (Dean). */
function BottomNav({ isAdmin, hasRole, pathname }: Props & { pathname: string }) {
  if (!hasRole) return null
  return (
    <nav className="space-y-0.5" aria-label="Main">
      <NavLink href="/learnings" active={pathname.startsWith("/learnings")}>
        {Icon.learnings} Learnings
      </NavLink>
      {isAdmin && (
        <NavLink href="/admin/clients" active={pathname.startsWith("/admin")}>
          {Icon.admin} Admin
        </NavLink>
      )}
      <NavLink href="/options" active={pathname.startsWith("/options")}>
        {Icon.options} Options
      </NavLink>
    </nav>
  )
}

function Profile({ name, roleLabel, profileId, avatarUrl, active }: { name: string; roleLabel: string | null; profileId: string; avatarUrl: string | null; active: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <Link href={`/people/${profileId}`} aria-current={active ? "page" : undefined} className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 transition-colors hover:bg-sidebar-accent/60", active && "bg-sidebar-accent")} title="Your profile">
        <Avatar name={name} url={avatarUrl} className="size-8" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm">{name}</span>
          {roleLabel && <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>}
        </span>
      </Link>
      <form action="/auth/signout" method="post">
        <button type="submit" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
          Sign out
        </button>
      </form>
    </div>
  )
}

/** Left sidebar on desktop; a compact top bar with a menu on small screens. */
export function AppSidebar(props: Props) {
  const pathname = usePathname()
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex">
        <Link href={props.lens ? "/" : "/clients"} className="mb-6 px-1.5">
          <AppMark />
        </Link>
        <div className="flex-1 overflow-y-auto">
          <NavBody {...props} pathname={pathname} />
        </div>
        <div className="space-y-3 border-t border-sidebar-border pt-3">
          <BottomNav {...props} pathname={pathname} />
          <Profile name={props.name} roleLabel={props.roleLabel} profileId={props.profileId} avatarUrl={props.avatarUrl} active={pathname === `/people/${props.profileId}`} />
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-sidebar-border bg-sidebar/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href={props.lens ? "/" : "/clients"}>
          <AppMark />
        </Link>
        <details className="group relative">
          <summary className="cursor-pointer list-none rounded-md border px-3 py-1.5 text-sm">Menu</summary>
          <div className="absolute right-0 mt-2 w-64 space-y-4 rounded-lg border bg-popover p-3 shadow-xl">
            <NavBody {...props} pathname={pathname} />
            <div className="space-y-3 border-t pt-3">
              <BottomNav {...props} pathname={pathname} />
              <Profile name={props.name} roleLabel={props.roleLabel} profileId={props.profileId} avatarUrl={props.avatarUrl} active={pathname === `/people/${props.profileId}`} />
            </div>
          </div>
        </details>
      </header>
    </>
  )
}
