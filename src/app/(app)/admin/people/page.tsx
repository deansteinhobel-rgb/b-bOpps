import { AdminForm, fieldClass } from "@/components/admin-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ROLE_LABEL, type AppRole } from "@/lib/auth"
import { listNotionPeople } from "@/lib/notion/users"
import { createClient } from "@/lib/supabase/server"
import { saveInvite, setProfileRole } from "../actions"

const ROLES = Object.entries(ROLE_LABEL) as [AppRole, string][]

export default async function PeoplePage() {
  const supabase = await createClient()
  const [{ data: profiles }, { data: invites }, notionPeople] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, notion_user_id, created_at").order("full_name"),
    supabase.from("team_invites").select("email, full_name, role, notion_user_id").order("full_name"),
    listNotionPeople().catch(() => []),
  ])
  const signedIn = new Set((profiles ?? []).map((p) => p.email))
  const notionName = new Map(notionPeople.map((n) => [n.id, n.name]))

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed-in people and their app role. Anyone without a role sees &ldquo;access pending&rdquo;. GTM leads have admin rights.
        </p>
        <ul className="mt-4 divide-y rounded-lg border bg-card text-sm">
          {(profiles ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <strong>{p.full_name ?? p.email}</strong> <span className="text-muted-foreground">{p.email}</span>
                {!p.notion_user_id && <span className="ml-2 text-xs text-rag-amber">no Notion user</span>}
              </span>
              <AdminForm action={setProfileRole} submitLabel="Set" className="flex items-center gap-2 space-y-0">
                <input type="hidden" name="id" value={p.id} />
                <select name="role" defaultValue={p.role ?? ""} className={`${fieldClass} w-52`} aria-label={`Role for ${p.full_name ?? p.email}`}>
                  <option value="">No access</option>
                  {ROLES.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </AdminForm>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl">Invites</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Who gets which role, and which Notion user they are, when they first sign in. Assign them to clients from each client&apos;s admin page.
        </p>
        <ul className="mt-4 divide-y rounded-lg border bg-card text-sm">
          {(invites ?? []).map((i) => (
            <li key={i.email} className="flex flex-wrap justify-between gap-2 px-4 py-2">
              <span>
                <strong>{i.full_name ?? i.email}</strong> <span className="text-muted-foreground">{i.email}</span>
              </span>
              <span className="text-muted-foreground">
                {ROLE_LABEL[i.role as AppRole]} · Notion: {i.notion_user_id ? (notionName.get(i.notion_user_id) ?? "linked") : "not linked"} ·{" "}
                {signedIn.has(i.email) ? "signed in" : "not signed in yet"}
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mt-6 text-lg">Add or update an invite</h3>
        <AdminForm action={saveInvite} submitLabel="Save invite" className="mt-2 max-w-3xl rounded-lg border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" name="email" type="email" required placeholder="name@bordeauxandburgundy.co.uk" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-name">Full name</Label>
              <Input id="inv-name" name="full_name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-role">Role</Label>
              <select id="inv-role" name="role" className={fieldClass} defaultValue="specialist">
                {ROLES.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-notion">Notion user (so they can own actions)</Label>
              <select id="inv-notion" name="notion_user_id" className={fieldClass} defaultValue="">
                <option value="">Not linked</option>
                {notionPeople.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                    {n.email ? ` (${n.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </AdminForm>
      </section>
    </div>
  )
}
