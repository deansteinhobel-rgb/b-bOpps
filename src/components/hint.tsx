"use client"

import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * A small "i" that explains a term in plain words on hover or focus (Dean: the Account tab is for
 * people without a paid media background).
 */
export function Hint({ children, className, label = "What does this mean?" }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger aria-label={label} className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-lime/60", className)}>
        <Info className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="block max-w-72 leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  )
}
