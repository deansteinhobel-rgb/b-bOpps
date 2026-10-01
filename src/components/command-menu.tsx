"use client"

import { Autocomplete } from "@base-ui/react/autocomplete"
import { Dialog } from "@base-ui/react/dialog"
import { useRouter } from "next/navigation"
import { useEffect, useId } from "react"
import { ClientLogo } from "@/components/brand"
import type { SidebarClient } from "@/components/app-sidebar"
import type { Lens } from "@/lib/lens"
import { cn } from "@/lib/utils"

type Item = { id: string; label: string; href: string; search: string; client?: SidebarClient }
type Group = { value: string; items: Item[] }

// Every client page, in both layouts (every URL works in both).
const CLIENT_PAGES = [
  { href: "", label: "At a glance" },
  { href: "/do", label: "To do" },
  { href: "/reporting", label: "Reporting" },
  { href: "/insights", label: "Optimize now" },
  { href: "/checks", label: "Checks" },
  { href: "/sprint", label: "Sprint" },
  { href: "/ideas", label: "Content ideas" },
  { href: "/briefs", label: "Briefs" },
  { href: "/brain", label: "Brain" },
]

function groups({ clients, isAdmin, lens, profileId }: { clients: SidebarClient[]; isAdmin: boolean; lens: Lens | null; profileId: string }): Group[] {
  const go: Item[] = [
    ...(lens ? [{ href: "/today", label: "Today" }] : []),
    { href: "/clients", label: "All clients" },
    { href: "/learnings", label: "Learnings" },
    { href: "/options", label: "Options" },
    { href: `/people/${profileId}`, label: "Your profile" },
    ...(isAdmin ? [{ href: "/admin/clients", label: "Admin: clients" }, { href: "/admin/people", label: "Admin: people" }] : []),
  ].map((p) => ({ ...p, id: p.href, search: p.label.toLowerCase() }))
  return [
    { value: "Go to", items: go },
    ...clients.map((c) => ({
      value: c.name,
      items: CLIENT_PAGES.map((p) => ({ id: `${c.slug}${p.href}`, label: p.label, href: `/clients/${c.slug}${p.href}`, search: `${c.name} ${p.label}`.toLowerCase(), client: c })),
    })),
  ]
}

/** Every word typed must appear somewhere: "dns rep" finds DNSFilter › Reporting. */
const matchWords = (item: Item, query: string) => query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => item.search.includes(w))

/**
 * "Jump to" (⌘K / Ctrl+K): every client page and the app's own pages, filtered as you type.
 * Base UI's Autocomplete handles the keyboard and focus; Enter or a click opens the page.
 */
export function CommandMenu({ open, onOpenChange, ...props }: { open: boolean; onOpenChange: (open: boolean) => void; clients: SidebarClient[]; isAdmin: boolean; lens: Lens | null; profileId: string }) {
  const router = useRouter()
  const hintId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden px-4 pt-[12dvh] pb-4">
          <Dialog.Popup
            aria-label="Jump to"
            className="flex max-h-[min(34rem,calc(100dvh-8rem))] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-card shadow-2xl transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0"
          >
            <Autocomplete.Root open inline items={groups(props)} itemToStringValue={(i: Item) => i.search} filter={matchWords} autoHighlight="always" keepHighlight>
              <Autocomplete.InputGroup className="flex items-center gap-2.5 border-b px-4">
                <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                  <circle cx="7" cy="7" r="5" />
                  <path d="m11 11 3 3" />
                </svg>
                <Autocomplete.Input
                  aria-label="Search pages"
                  aria-describedby={hintId}
                  placeholder="Jump to a client or page…"
                  className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground any-pointer-coarse:text-base"
                />
              </Autocomplete.InputGroup>
              <Dialog.Close className="sr-only">Close</Dialog.Close>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2 [scroll-padding-block:0.5rem]">
                <Autocomplete.Empty>
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches. Try a client name or a tab, like &ldquo;camber sprint&rdquo;.</p>
                </Autocomplete.Empty>
                <Autocomplete.List>
                  {(group: Group) => (
                    <Autocomplete.Group key={group.value} items={group.items} className="not-last:mb-2">
                      <Autocomplete.GroupLabel className="flex items-center gap-2 px-4 pt-1 pb-1.5 text-xs text-muted-foreground">
                        {group.items[0]?.client && <ClientLogo name={group.items[0].client.name} logoUrl={group.items[0].client.logo_url} size="xs" />}
                        {group.value}
                      </Autocomplete.GroupLabel>
                      <Autocomplete.Collection>
                        {(item: Item) => (
                          <Autocomplete.Item
                            key={item.id}
                            value={item}
                            onClick={() => go(item.href)}
                            className={cn(
                              "group relative mx-2 flex min-h-9 cursor-default items-center justify-between gap-3 rounded-md px-3 text-sm text-body outline-none select-none [scroll-margin-block:0.5rem]",
                              "data-highlighted:bg-secondary data-highlighted:text-foreground",
                            )}
                          >
                            <span className="truncate">{item.label}</span>
                            <span className="hidden text-xs text-muted-foreground group-data-highlighted:inline" aria-hidden>
                              Open ↵
                            </span>
                          </Autocomplete.Item>
                        )}
                      </Autocomplete.Collection>
                    </Autocomplete.Group>
                  )}
                </Autocomplete.List>
              </div>

              <p id={hintId} className="flex items-center gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
                <span>
                  <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
                </span>
                <span>
                  <Kbd>Enter</Kbd> to open
                </span>
                <span>
                  <Kbd>Esc</Kbd> to close
                </span>
              </p>
            </Autocomplete.Root>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[11px] leading-none text-muted-foreground", className)}>{children}</kbd>
}

/** The team is on Macs (Dean, 2026-10-01), so the hint always reads ⌘K; Ctrl+K still opens it on Windows. */
export const SHORTCUT_LABEL = "⌘K"
