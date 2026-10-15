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
 * MADE Avenue: public/fonts/ is a git-ignored local copy for development; production falls back to the
 * Supabase project's public "brand" bucket (`pnpm upload:font`). The address comes from the env so a
 * new Supabase project only needs the env changed (docs/account-move.md). font-src allows it in src/proxy.ts.
 */
const brandFont = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/brand/fonts/MADEAvenue-Regular.otf`
const fontFace = `@font-face{font-family:"MADE Avenue";src:url("/fonts/MADEAvenue-Regular.otf") format("opentype"),url("${brandFont}") format("opentype");font-weight:400;font-style:normal;font-display:swap}`

/**
 * Reading the request headers makes every page render per request, which the CSP nonce needs (a page
 * built ahead of time can't carry one; see src/proxy.ts). Every page is behind sign-in anyway.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await headers()
  return (
    <html lang="en-US" className="h-full antialiased">
      <head>
        <style dangerouslySetInnerHTML={{ __html: fontFace }} />
      </head>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  )
}
