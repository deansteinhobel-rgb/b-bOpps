import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getProfile, isAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

// First version: the clients you can see (RLS decides). Pacing, check completion and action
// counts come in later steps.
export default async function ClientsPage() {
  const profile = await getProfile()
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, slug, currency, client_team(role, profiles(full_name, email))")
    .eq("active", true)
    .order("name")

  return (
    <>
      <p className="eyebrow">{isAdmin(profile) ? "All clients" : "My clients"}</p>
      <h1 className="mt-2 text-4xl">Clients</h1>
      {!clients?.length ? (
        <p className="mt-6 text-muted-foreground">No clients yet. {isAdmin(profile) ? "Run the seed script or add one in Admin." : "Ask an admin to assign you to a client."}</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/clients/${c.slug}`} className="group">
              <Card className="transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <CardTitle className="font-heading text-2xl font-normal">{c.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {(c.client_team as unknown as { role: string; profiles: { full_name: string | null; email: string } | null }[])
                    .map((t) => t.profiles?.full_name ?? t.profiles?.email)
                    .filter(Boolean)
                    .join(", ") || "No team assigned"}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
