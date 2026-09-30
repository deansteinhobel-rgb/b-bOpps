import Link from "next/link"
import { AppMark } from "@/components/brand"
import { buttonVariants } from "@/components/ui/button"

export const metadata = { title: "Not found" }

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <AppMark />
      <h1 className="mt-10 text-4xl text-lime sm:text-5xl">Nothing poured here</h1>
      <p className="mt-4 text-body">That page doesn&apos;t exist, or it has moved. Every client, sprint and check is a click away from the client list.</p>
      <div className="mt-8">
        <Link href="/clients" className={buttonVariants({ size: "lg" })}>
          Go to clients
        </Link>
      </div>
    </main>
  )
}
