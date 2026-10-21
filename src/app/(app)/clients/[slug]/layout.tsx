import Link from "next/link"
import { notFound } from "next/navigation"
import { ClientLogo } from "@/components/brand"
import { canEdit, canRunContentIdeas, getProfile } from "@/lib/auth"
import { libraryConfig } from "@/lib/content-library/config"
import { tabGroups } from "@/lib/tab-groups"
import { createClient } from "@/lib/supabase/server"
import { ClientTabs } from "./client-tabs"

export async function generateMetadata({ params }: LayoutProps<"/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("clients").select("name").eq("slug", slug).maybeSingle()
  return { title: data?.name ?? "Client" }
}

export default async function ClientLayout({ children, params }: LayoutProps<"/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  // RLS: a client you aren't assigned to simply isn't found.
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, name, logo_url, website").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()

  // The client's identity anchors the page (Dean, 2026-10-15): a quiet way back, the logo, name and
  // domain, then the sections on one hairline. Everything shares the content column's left edge.
  return (
    <div>
      <header className="space-y-4">
        <Link href="/clients" className="inline-flex h-6 items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <span aria-hidden>←</span> All clients
        </Link>
        <div className="flex min-w-0 items-center gap-4">
          <ClientLogo name={client.name} logoUrl={client.logo_url} size="lg" className="size-11 rounded-md" />
          <div className="min-w-0">
            <h1 className="truncate text-[28px] leading-9">{client.name}</h1>
            {client.website && <p className="truncate text-[13px] leading-5 text-muted-foreground">{client.website}</p>}
          </div>
        </div>
      </header>
      <div className="mt-6">
        <ClientTabs slug={slug} groups={tabGroups({ contentLibrary: libraryConfig(slug) !== null })} />
      </div>
      {!canEdit(me) && (
        <p className="mt-6 text-[13px] text-muted-foreground">
          {canRunContentIdeas(me)
            ? "You can see everything here and get content ideas. Saving, briefing and editing are for the paid media team."
            : "You have view access: you can see everything here, but saving, briefing and editing are for the paid media team."}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </div>
  )
}
