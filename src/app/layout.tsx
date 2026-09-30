import type { Metadata } from "next"
import { headers } from "next/headers"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

export const metadata: Metadata = {
  title: { default: "Lumaux", template: "%s · Lumaux" },
  description: "Lumaux by Bordeaux & Burgundy: paid media performance, weekly QA and test sprints per client.",
}

/**
 * Reading the request headers makes every page render per request, which the CSP nonce needs (a page
 * built ahead of time can't carry one; see src/proxy.ts). Every page is behind sign-in anyway.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await headers()
  return (
    <html lang="en-US" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  )
}
