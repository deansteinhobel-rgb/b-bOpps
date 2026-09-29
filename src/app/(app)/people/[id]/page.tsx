import Link from "next/link"
import { notFound } from "next/navigation"
import { Avatar, ClientLogo } from "@/components/brand"
import { getProfile, isAdmin, ROLE_LABEL, type AppRole } from "@/lib/auth"
import { isOnline, lastActive, longDate } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"
import { ProfileEditor } from "./profile-editor"

export const metadata = { title: "Profile" }

const TEAM_ROLE: Record<string, string> = { gtm_lead: "GTM lead", am: "Account manager", specialist: "Paid media specialist" }

/** A person's profile: who they are, how to reach them, their clients and when they last used the app. */
export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const me = await getProfile()
  const supabase = await createClient()
  const [{ data: p }, { data: teams }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, notion_user_id, avatar_url, job_title, phone, location, timezone, bio, last_seen_at, created_at").eq("id", id).maybeSingle(),
    supabase.from("client_team").select("role, clients(slug, name, logo_url)").eq("profile_id", id).is("removed_at", null),
  ])
  if (!p) notFound()
  const own = me.id === p.id
  const canEdit = own || isAdmin(me)
  const name = p.full_name ?? p.email
  const localTime = (() => {
    try {
      return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: p.timezone }).format(new Date())
    } catch {
      return null
    }
  })()

  return (
    <div className="space-y-8">
      <section className="surface relative overflow-hidden">
        <div aria-hidden className="h-24 bg-gradient-to-r from-lime/15 via-violet/10 to-transparent" />
        <div className="flex flex-wrap items-end gap-5 px-6 pb-6">
          <Avatar name={name} url={p.avatar_url} className="-mt-12 size-24 text-2xl ring-4 ring-card" />
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-3xl leading-tight">{name}</h1>
            <p className="text-sm text-muted-foreground">
              {[p.job_title, p.role ? ROLE_LABEL[p.role as AppRole] : "No role yet"].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p className="flex items-center justify-end gap-1.5">
              <span className={isOnline(p.last_seen_at) ? "size-2 rounded-full bg-rag-green" : "size-2 rounded-full bg-muted-foreground/40"} aria-hidden />
              {lastActive(p.last_seen_at)}
            </p>
            <p>Joined {longDate(p.created_at.slice(0, 10))}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {canEdit ? (
            <ProfileEditor
              profileId={p.id}
              own={own}
              name={name}
              avatarUrl={p.avatar_url}
              defaults={{ full_name: p.full_name ?? "", job_title: p.job_title ?? "", phone: p.phone ?? "", location: p.location ?? "", timezone: p.timezone ?? "Europe/London", bio: p.bio ?? "" }}
            />
          ) : (
            <section className="surface space-y-4 p-6">
              <h2 className="text-xl">About</h2>
              <p className="text-sm whitespace-pre-line text-muted-foreground">{p.bio || "Nothing here yet."}</p>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="surface divide-y text-sm">
            <h3 className="px-5 py-3 text-sm font-semibold">Contact</h3>
            <dl className="divide-y">
              <Row label="Email">
                <a href={`mailto:${p.email}`} className="hover:underline">
                  {p.email}
                </a>
              </Row>
              {p.phone && <Row label="Phone">{p.phone}</Row>}
              {p.location && <Row label="Location">{p.location}</Row>}
              <Row label="Local time">{localTime ? `${localTime} (${p.timezone.replace(/_/g, " ")})` : p.timezone}</Row>
              <Row label="Notion">{p.notion_user_id ? "Linked (can own actions)" : "Not linked yet"}</Row>
            </dl>
          </section>

          <section className="surface divide-y text-sm">
            <h3 className="px-5 py-3 text-sm font-semibold">Clients</h3>
            {(teams ?? []).length === 0 && <p className="px-5 py-3 text-muted-foreground">{p.role === "admin" || p.role === "gtm_lead" ? "Sees every client." : "Not on a client team yet."}</p>}
            {(teams ?? []).map((t, i) => {
              const c = t.clients as unknown as { slug: string; name: string; logo_url: string | null } | null
              if (!c) return null
              return (
                <Link key={i} href={`/clients/${c.slug}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-accent/40">
                  <ClientLogo name={c.name} logoUrl={c.logo_url} size="sm" />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{TEAM_ROLE[t.role] ?? t.role}</span>
                </Link>
              )
            })}
          </section>
          {own && (
            <Link href="/options" className="block text-xs text-muted-foreground hover:text-foreground">
              Preferences, your stats and feedback are in Options →
            </Link>
          )}
          {isAdmin(me) && !own && (
            <Link href="/admin/people" className="block text-xs text-muted-foreground hover:text-foreground">
              Change role or Notion user in Admin → People
            </Link>
          )}
        </aside>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-5 py-2.5">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}
