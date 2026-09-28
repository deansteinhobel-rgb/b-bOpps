import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ClientTabs } from "./client-tabs"

export default async function ClientLayout({ children, params }: LayoutProps<"/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  // RLS: a client you aren't assigned to simply isn't found.
  const { data: client } = await supabase.from("clients").select("id, name").eq("slug", slug).maybeSingle()
  if (!client) notFound()

  return (
    <>
      <Link href="/clients" className="eyebrow hover:text-foreground">
        ← Clients
      </Link>
      <h1 className="mt-2 text-4xl">{client.name}</h1>
      <div className="mt-6 border-b">
        <ClientTabs slug={slug} />
      </div>
      <div className="pt-6">{children}</div>
    </>
  )
}
