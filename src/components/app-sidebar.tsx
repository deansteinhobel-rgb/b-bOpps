"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { AppMark, Avatar, ClientLogo } from "@/components/brand"
import { CommandMenu, Kbd, SHORTCUT_LABEL } from "@/components/command-menu"
import { cn } from "@/lib/utils"

export type SidebarClient = { slug: string; name: string; logo_url: string | null }
type Props = { clients: SidebarClient[]; name: string; roleLabel: string | null; isAdmin: boolean; hasRole: boolean; profileId: string; avatarUrl: string | null }

/** Clients in the list to see how they look, not set up yet (Dean, 2026-10-01). */
const COMING_SOON = new Set(["drillsense", "filevine"])

// The sidebar is one navigation system (Dean, 2026-10-15; Linear as the reference). Every row shares
// one shape: 36px high, 8px padding, a 20px icon slot, 14px text on one baseline. The current page is a
// soft lift with white medium text; lime stays on the brand mark and the keyboard focus ring.
const ROW = "relative flex h-9 w-full items-center gap-3 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
const ROW_ON = "bg-white/[0.08] font-medium text-foreground"
const ROW_OFF = "text-body hover:bg-white/[0.04] hover:text-foreground"

function NavRow({ href, active, icon, muted, trailing, children }: { href: string; active: boolean; icon: React.ReactNode; muted?: boolean; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(ROW, active ? ROW_ON : ROW_OFF, muted && !active && "text-muted-foreground")}>
      <span className={cn("flex size-5 shrink-0 items-center justify-center", active ? "text-foreground" : "text-muted-foreground", muted && !active && "opacity-50")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  )
}

/** A section heading inside the sidebar: 13px, sentence case, quieter than the rows under it. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="flex h-8 items-center px-2 text-[13px] font-medium text-muted-foreground">{children}</div>
}

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
)
const Icon = {
  search: svg(
    <>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2L17 17" />
    </>,
  ),
  today: svg(<path d="M4 5.5l1.5 1.5L8 4.5M4 10.5L5.5 12 8 9.5M4 15.5L5.5 17 8 14.5M11 6h5M11 11h5M11 16h5" />),
  clients: svg(
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" />
    </>,
  ),
  learnings: svg(<path d="M10 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM8 17h4" />),
  options: svg(
    <>
      <path d="M4 6h7M15 6h1M4 14h1M9 14h7" />
      <circle cx="13" cy="6" r="2" />
      <circle cx="7" cy="14" r="2" />
    </>,
  ),
  admin: svg(
    <>
      <path d="M10 2.5l1.6 2.2 2.7-.4.4 2.7 2.2 1.6-1.4 2.4 1.4 2.4-2.2 1.6-.4 2.7-2.7-.4L10 17.5l-1.6-2.2-2.7.4-.4-2.7-2.2-1.6L4.5 9 3.1 6.6l2.2-1.6.4-2.7 2.7.4z" />
      <circle cx="10" cy="10" r="2.3" />
    </>,
  ),
}

/** Search is the first row (opens Jump to; ⌘K / Ctrl+K anywhere), so it reads as part of the navigation. */
function SearchRow({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-keyshortcuts="Meta+K Control+K" className={cn(ROW, ROW_OFF, "text-left")}>
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{Icon.search}</span>
      <span className="min-w-0 flex-1 truncate">Search</span>
      <Kbd className="border-white/10">{SHORTCUT_LABEL}</Kbd>
    </button>
  )
}

/** Where you work across clients: search, Today (the daily list) and every client. */
function GlobalNav({ pathname, onSearch }: { pathname: string; onSearch?: () => void }) {
  return (
    <nav className="space-y-0.5" aria-label="Main">
      {onSearch && <SearchRow onClick={onSearch} />}
      <NavRow href="/today" active={pathname.startsWith("/today")} icon={Icon.today}>
        Today
      </NavRow>
      <NavRow href="/clients" active={pathname === "/clients"} icon={Icon.clients}>
        All clients
      </NavRow>
    </nav>
  )
}

/** The client directory: its own heading, and it scrolls on its own when the list grows. */
function ClientDirectory({ clients, pathname }: { clients: SidebarClient[]; pathname: string }) {
  return (
    <nav aria-label="Clients" className="space-y-0.5">
      <SectionLabel>Clients</SectionLabel>
      <ul className="space-y-0.5">
        {clients.map((c) => {
          const soon = COMING_SOON.has(c.slug)
          return (
            <li key={c.slug}>
              <NavRow
                href={`/clients/${c.slug}`}
                active={pathname === `/clients/${c.slug}` || pathname.startsWith(`/clients/${c.slug}/`)}
                icon={<ClientLogo name={c.name} logoUrl={c.logo_url} size="sm" />}
                muted={soon}
                trailing={soon ? <span className="shrink-0 rounded px-1.5 text-xs leading-5 text-muted-foreground ring-1 ring-white/10 ring-inset">Soon</span> : null}
              >
                {c.name}
              </NavRow>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Learnings, Admin and Options sit at the bottom, above the profile (Dean). */
function UtilityNav({ isAdmin, pathname }: { isAdmin: boolean; pathname: string }) {
  return (
    <nav className="space-y-0.5" aria-label="More">
      <NavRow href="/learnings" active={pathname.startsWith("/learnings")} icon={Icon.learnings}>
        Learnings
      </NavRow>
      {isAdmin && (
        <NavRow href="/admin/clients" active={pathname.startsWith("/admin")} icon={Icon.admin}>
          Admin
        </NavRow>
      )}
      <NavRow href="/options" active={pathname.startsWith("/options")} icon={Icon.options}>
        Options
      </NavRow>
    </nav>
  )
}

function Profile({ name, roleLabel, profileId, avatarUrl, active }: { name: string; roleLabel: string | null; profileId: string; avatarUrl: string | null; active: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/people/${profileId}`}
        aria-current={active ? "page" : undefined}
        className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-md p-1.5 transition-colors outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring", active && "bg-white/[0.08]")}
        title="Your profile"
      >
        <Avatar name={name} url={avatarUrl} className="size-7" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{name}</span>
          {roleLabel && <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>}
        </span>
      </Link>
      <form action="/auth/signout" method="post">
        <button type="submit" className="h-8 rounded-md px-2 text-[13px] text-muted-foreground transition-colors outline-none hover:bg-white/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          Sign out
        </button>
      </form>
    </div>
  )
}

/**
 * Left sidebar on desktop; a compact top bar with a menu on small screens. Top to bottom: the brand,
 * where you work (Search, Today, All clients), the client directory (scrolls on its own), then
 * Learnings / Admin / Options and your profile. The brand and the top stay put however long the list.
 */
export function AppSidebar(props: Props) {
  const pathname = usePathname()
  const [jump, setJump] = useState(false)
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 pt-4 pb-3 lg:flex">
        <Link href="/" className="flex h-10 items-center rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <AppMark />
        </Link>
        {props.hasRole && (
          <>
            <div className="mt-6">
              <GlobalNav pathname={pathname} onSearch={() => setJump(true)} />
            </div>
            <div className="mt-6 min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
              <ClientDirectory clients={props.clients} pathname={pathname} />
            </div>
          </>
        )}
        {!props.hasRole && <div className="flex-1" />}
        <div className="mt-3 space-y-2 border-t border-sidebar-border pt-3">
          {props.hasRole && <UtilityNav isAdmin={props.isAdmin} pathname={pathname} />}
          <Profile name={props.name} roleLabel={props.roleLabel} profileId={props.profileId} avatarUrl={props.avatarUrl} active={pathname === `/people/${props.profileId}`} />
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-sidebar-border bg-sidebar/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur lg:hidden">
        <Link href="/">
          <AppMark />
        </Link>
        <div className="flex items-center gap-2">
          {props.hasRole && (
            <button type="button" onClick={() => setJump(true)} aria-label="Search for a client or page" className="flex size-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
              {Icon.search}
            </button>
          )}
          <details className="group relative">
            <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border px-3 text-sm transition-colors hover:border-border-strong group-open:border-border-strong [&::-webkit-details-marker]:hidden">Menu</summary>
            <div className="absolute right-0 mt-2 max-h-[calc(100dvh-5rem)] w-64 space-y-4 overflow-y-auto rounded-lg border bg-popover p-3 shadow-xl">
              {props.hasRole && (
                <>
                  <GlobalNav pathname={pathname} />
                  <ClientDirectory clients={props.clients} pathname={pathname} />
                </>
              )}
              <div className="space-y-2 border-t pt-3">
                {props.hasRole && <UtilityNav isAdmin={props.isAdmin} pathname={pathname} />}
                <Profile name={props.name} roleLabel={props.roleLabel} profileId={props.profileId} avatarUrl={props.avatarUrl} active={pathname === `/people/${props.profileId}`} />
              </div>
            </div>
          </details>
        </div>
      </header>
      {props.hasRole && <CommandMenu open={jump} onOpenChange={setJump} clients={props.clients} isAdmin={props.isAdmin} profileId={props.profileId} />}
    </>
  )
}
