import Link from "next/link"
import { Avatar, ClientLogo, PlatformIcon, type AnyPlatform } from "@/components/brand"
import { type ActivitySource, SOURCE_LABEL } from "@/lib/activity"
import { loadActivity } from "@/lib/activity-load"
import { createAdminClient } from "@/lib/supabase/admin"
import { cn } from "@/lib/utils"
import { ActivityFilters } from "./activity-filters"

export const metadata = { title: "Activity" }

const SOURCES = Object.keys(SOURCE_LABEL) as ActivitySource[]
const SOURCE_CLS: Record<ActivitySource, string> = {
  app: "border-white/15 text-body",
  platform: "border-lime/40 text-lime",
  notion: "border-white/15 text-muted-foreground",
  outside: "border-[#ff3d8a]/40 text-[#ff3d8a]",
}
const TAG_CLS = { "dry run": "border-white/15 text-muted-foreground", failed: "border-rag-red/40 bg-rag-red/10 text-rag-red", bulk: "border-white/15 text-muted-foreground" }

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(iso))
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(iso))

/**
 * Every change people make (Dean, 2026-10-21): edits in Lumaux, what Lumaux sent to the ad
 * platforms and Notion, and changes made inside the platforms. Admins only (the layout checks).
 */
export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined)
  const source = SOURCES.find((s) => s === one(sp.source))
  const days = [7, 30, 90].find((d) => String(d) === one(sp.days)) ?? 7
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined)

  const admin = createAdminClient()
  const [items, { data: clients }, { data: people }] = await Promise.all([
    loadActivity(admin, { days, source, clientId: uuid(one(sp.client)), profileId: uuid(one(sp.who)) }),
    admin.from("clients").select("id, name, slug, logo_url").order("name"),
    admin.from("profiles").select("id, full_name, email, avatar_url").not("role", "is", null).order("full_name"),
  ])
  const clientById = new Map((clients ?? []).map((c) => [c.id, c]))
  const personById = new Map((people ?? []).map((p) => [p.id, p]))
  const byDay = new Map<string, typeof items>()
  for (const item of items) {
    const d = day(item.at)
    byDay.set(d, [...(byDay.get(d) ?? []), item])
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every change people make: edits in Lumaux, what Lumaux sent to the ad platforms and Notion, and changes made inside the platforms. Nothing here can be edited or deleted.</p>
      </div>
      <ActivityFilters clients={(clients ?? []).map((c) => ({ id: c.id, name: c.name }))} people={(people ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email }))} />

      {items.length === 0 && <p className="surface px-5 py-10 text-center text-sm text-muted-foreground">No changes in this view.</p>}
      {[...byDay].map(([d, list]) => (
        <section key={d} className="space-y-2">
          <h2 className="flex items-baseline gap-2 font-sans text-sm font-medium text-body">
            {d} <span className="text-xs text-muted-foreground">{list.length}</span>
          </h2>
          <ul className="surface divide-y">
            {list.map((item) => {
              const who = item.profileId ? personById.get(item.profileId) : null
              const client = item.clientId ? clientById.get(item.clientId) : null
              const name = who ? (who.full_name ?? who.email) : (item.actorName ?? "Someone")
              return (
                <li key={item.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 px-5 py-3 text-sm">
                  <span className="pt-0.5 text-xs text-muted-foreground tabular-nums">{time(item.at)}</span>
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {who ? (
                        <Link href={`/people/${who.id}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
                          <Avatar name={name} url={who.avatar_url} className="size-5 text-[9px]" />
                          {name}
                        </Link>
                      ) : (
                        <span className="font-medium">{name}</span>
                      )}
                      <span className="text-body">{item.title}</span>
                    </p>
                    {item.details.length > 0 && <p className="text-[13px] break-words text-muted-foreground">{item.details.join(" · ")}</p>}
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn("rounded-full border px-2 py-0.5 font-medium", SOURCE_CLS[item.source])}>{SOURCE_LABEL[item.source]}</span>
                      {item.tag && <span className={cn("rounded-full border px-2 py-0.5 font-medium", TAG_CLS[item.tag])}>{item.tag === "dry run" ? "Dry run" : item.tag === "failed" ? "Failed" : "Bulk"}</span>}
                      {item.platform && <PlatformIcon platform={item.platform as AnyPlatform} />}
                      {client && (
                        <Link href={`/clients/${client.slug}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <ClientLogo name={client.name} logoUrl={client.logo_url} />
                          {client.name}
                        </Link>
                      )}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {items.length >= 500 && <p className="text-xs text-muted-foreground">Showing the latest 500. Pick a client, a person or a shorter period to see the rest.</p>}
    </div>
  )
}
