"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ChevronRight, XIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

/**
 * An At a glance card (new layout, Dean 2026-09-30: "don't make us scroll, but let us click in"):
 * the headline numbers only, and the full section in a side panel on click. The URL carries
 * ?view=<id>, so a panel can be shared and the back button closes it.
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
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const open = params.get("view") === id
  const go = (next: boolean) => {
    const p = new URLSearchParams(params.toString())
    if (next) p.set("view", id)
    else p.delete("view")
    const q = p.toString()
    router[next ? "push" : "replace"](q ? `${pathname}?${q}` : pathname, { scroll: false })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => go(true)}
        aria-haspopup="dialog"
        className={cn("group surface flex min-w-0 flex-col p-4 text-left transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-lime/60", className)}
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {meta && <span className="truncate text-[11px] text-muted-foreground">{meta}</span>}
          </span>
          <span className="flex shrink-0 items-center text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
            Details <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </span>
        {/* The summary is for reading; the whole card opens the panel. */}
        <span className="pointer-events-none mt-3 block min-w-0 flex-1">{summary}</span>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && go(false)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-150 supports-backdrop-filter:backdrop-blur-xs data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
          <DialogPrimitive.Popup
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background text-sm shadow-2xl outline-none duration-200 data-closed:animate-out data-closed:slide-out-to-right data-open:animate-in data-open:slide-in-from-right",
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
