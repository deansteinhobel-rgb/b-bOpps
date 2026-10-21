import Link from "next/link"
import { notFound } from "next/navigation"
import { getProfile, isAdmin } from "@/lib/auth"

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await getProfile()
  if (!isAdmin(profile)) notFound()
  return (
    <>
      {/* "Admin" leads the section links on one line, not as an eyebrow above them (taste sweep). */}
      <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label="Admin sections">
        <span className="font-medium text-foreground">Admin</span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <Link href="/admin/clients" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Clients
        </Link>
        <Link href="/admin/people" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          People
        </Link>
        <Link href="/admin/activity" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Activity
        </Link>
        <Link href="/admin/feedback" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Feedback
        </Link>
        <Link href="/admin/slack" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Slack
        </Link>
      </nav>
      <div className="pt-6">{children}</div>
    </>
  )
}
