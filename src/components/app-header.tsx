import Link from "next/link"

/** Black top bar with the wordmark, matching bordeauxandburgundy.com. */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="bg-sidebar text-sidebar-foreground">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/clients" className="flex items-baseline gap-3">
          <span className="font-heading text-lg leading-none tracking-tight">Bordeaux &amp; Burgundy</span>
          <span className="eyebrow text-lime!">Account Ops</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">{children}</nav>
      </div>
    </header>
  )
}
