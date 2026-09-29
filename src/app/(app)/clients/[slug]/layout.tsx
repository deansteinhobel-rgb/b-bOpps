import Link from "next/link"
import { notFound } from "next/navigation"
import { ClientLogo } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import { canEdit, getProfile } from "@/lib/auth"
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/clients" className="hover:text-foreground">
            ← Clients
          </Link>
        }
        lead={<ClientLogo name={client.name} logoUrl={client.logo_url} size="lg" className="size-12" />}
        title={client.name}
        description={client.website ?? undefined}
      />
      <div className="border-b">
        <ClientTabs slug={slug} />
      </div>
      {!canEdit(me) && (
        <p className="rounded-md border bg-card px-4 py-2 text-sm text-muted-foreground">
          You have view access: you can see everything here, but saving, briefing and editing are for the paid media team.
        </p>
      )}
      <div>{children}</div>
    </div>
  )
}
