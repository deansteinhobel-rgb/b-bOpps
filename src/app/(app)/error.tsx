"use client"

import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"

/** Something on a page failed to load: say so plainly, with one way forward (try again) and one way out. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-xl py-10">
      <h1 className="text-3xl sm:text-4xl">This page didn&apos;t load</h1>
      <p className="mt-3 text-body">
        Something went wrong on our side while loading it. Trying again usually fixes it; if it keeps happening, send Dean the reference below.
      </p>
      {error.digest && <p className="mt-2 text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/clients" className={buttonVariants({ variant: "outline" })}>
          Back to clients
        </Link>
      </div>
    </div>
  )
}
