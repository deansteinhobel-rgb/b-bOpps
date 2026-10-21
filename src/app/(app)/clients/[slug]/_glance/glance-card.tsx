"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ChevronRight, XIcon } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

/**
 * An At a glance card (new layout, Dean 2026-09-30: "don't make us scroll, but let us click in"):
 * the headline numbers only, and the full section in a side panel on click. The URL carries
 * ?view=<id>, so a panel can be shared and the back button closes it.
 *
 * Opening and closing only change the URL in the browser (history.pushState / replaceState, which
 * Next keeps in sync with useSearchParams), never a server navigation: the panel's content is already
 * on the page, and a round trip re-rendered the whole Summary first (several seconds to close, 2026-10-15).
 */
export function GlanceCard({
  id,
  title,
  meta,
  summary,
  detailTitle,
  detailDescription,
  detail,
  className,
  wide = true,
}: {
  id: string
  title: string
  /** A short line beside the title: "Sept so far", "last 7 days". */
  meta?: string
  summary: React.ReactNode
  detailTitle?: string
  detailDescription?: string
  detail: React.ReactNode
  className?: string
  wide?: boolean
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const open = params.get("view") === id
  const go = (next: boolean) => {
    const p = new URLSearchParams(params.toString())
    if (next) p.set("view", id)
    else p.delete("view")
    const q = p.toString()
    window.history[next ? "pushState" : "replaceState"](null, "", q ? `${pathname}?${q}` : pathname)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => go(true)}
        aria-haspopup="dialog"
        className={cn("group surface flex min-w-0 cursor-pointer flex-col p-4 text-left transition-colors outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {meta && <span className="truncate text-xs text-muted-foreground">{meta}</span>}
          </span>
          <span className="flex shrink-0 items-center text-xs text-muted-foreground transition-colors group-hover:text-foreground">
            Details <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </span>
        {/* The summary is for reading; the whole card opens the panel. */}
        <span className="pointer-events-none mt-3 flex min-w-0 flex-1 flex-col">{summary}</span>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && go(false)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 duration-150 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
          <DialogPrimitive.Popup
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background text-sm shadow-2xl outline-none duration-200 data-closed:animate-out data-closed:slide-out-to-right data-open:animate-in data-open:slide-in-from-right", // taste-skill-ignore: the side panel is a real overlay
              wide ? "max-w-4xl" : "max-w-2xl",
            )}
          >
            <header className="flex items-start gap-3 border-b px-5 py-4">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="font-heading text-2xl leading-tight">{detailTitle ?? title}</DialogPrimitive.Title>
                {detailDescription && <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{detailDescription}</DialogPrimitive.Description>}
              </div>
              <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
                <XIcon className="size-4" />
              </DialogPrimitive.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{detail}</div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
