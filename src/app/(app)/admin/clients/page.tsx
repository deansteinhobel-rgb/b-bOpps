import Link from "next/link"
import { AdminForm } from "@/components/admin-form"
import { createClient } from "@/lib/supabase/server"
import { saveClient } from "../actions"
import { ClientFields } from "./client-fields"

export default async function AdminClientsPage() {
  const supabase = await createClient()
  const [{ data: clients }, { data: optionRows }] = await Promise.all([
    supabase.from("clients").select("id, name, slug, notion_client_option, active").order("name"),
    // RLS: admins see unmapped mirror rows too.
    supabase.from("notion_pages_mirror").select("client_id, client_option:properties->>Client").eq("in_trash", false).limit(5000),
  ])
  const taken = new Set((clients ?? []).map((c) => c.notion_client_option))
  const counts = new Map<string, number>()
  for (const r of optionRows ?? []) {
    if (r.client_id) continue
    const k = (r.client_option as string | null) ?? "(no Client set)"
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const notionOptions = [...new Set((optionRows ?? []).map((r) => r.client_option as string | null).filter(Boolean) as string[])].sort()
  const unmapped = [...counts.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl">Clients</h1>
        <ul className="mt-4 divide-y rounded-lg border bg-card">
          {(clients ?? []).map((c) => (
            <li key={c.id}>
              <Link href={`/admin/clients/${c.slug}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary/50">
                <span className="font-bold">{c.name}</span>
                <span className="text-muted-foreground">
                  Notion: {c.notion_client_option}
                  {!c.active && " · inactive"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl">New client</h2>
        <AdminForm action={saveClient} submitLabel="Create client" className="mt-4 max-w-3xl rounded-lg border bg-card p-4">
          <ClientFields notionOptions={notionOptions} taken={taken} />
        </AdminForm>
      </section>

      <section>
        <h2 className="text-2xl">Unmapped Notion pages</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Master Production rows whose Client isn&apos;t set up here. They stay out of every client view. Create a client with that Notion option to bring them in (they
          map on the next Notion sync).
        </p>
        {unmapped.length === 0 ? (
          <p className="mt-3 text-sm">Everything is mapped.</p>
        ) : (
          <ul className="mt-3 grid gap-x-6 gap-y-1 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {unmapped.map(([option, n]) => (
              <li key={option} className="flex justify-between gap-2">
                <span>{option}</span>
                <span className="text-muted-foreground tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
