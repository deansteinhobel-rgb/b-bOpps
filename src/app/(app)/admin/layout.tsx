import Link from "next/link"
import { notFound } from "next/navigation"
import { getProfile, isAdmin } from "@/lib/auth"

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await getProfile()
  if (!isAdmin(profile)) notFound()
  return (
    <>
      <p className="eyebrow">Admin</p>
      <nav className="mt-2 flex gap-4 text-sm" aria-label="Admin sections">
        <Link href="/admin/clients" className="underline-offset-4 hover:underline">
          Clients
        </Link>
        <Link href="/admin/people" className="underline-offset-4 hover:underline">
          People
        </Link>
        <Link href="/admin/feedback" className="underline-offset-4 hover:underline">
          Feedback
        </Link>
      </nav>
      <div className="pt-6">{children}</div>
    </>
  )
}
