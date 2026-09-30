import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { getProfile, isAdmin } from "@/lib/auth"
import { FEEDBACK_STATUS } from "@/lib/feedback"
import { lastActive, longDate } from "@/lib/format"
import { myStats } from "@/lib/stats"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { lensOf, newLayout } from "@/lib/lens"
import { FeedbackForm, PreferencesForm } from "./options-forms"

export const metadata = { title: "Options" }

const TABS = [
  { key: "preferences", label: "Preferences" },
  { key: "stats", label: "Your stats" },
  { key: "feature", label: "Suggest a feature" },
  { key: "bug", label: "Report a bug" },
] as const
type Tab = (typeof TABS)[number]["key"]

/** Options (Dean, 2026-09-29): preferences, your own stats, suggest a feature, report a bug. */
export default async function OptionsPage({ searchParams }: PageProps<"/options">) {
  const { tab: raw } = await searchParams
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "preferences"
  const me = await getProfile()
  const supabase = await createClient()
  const [{ data: clients }, { data: mine }, { data: profile }] = await Promise.all([
    supabase.from("clients").select("slug, name").eq("active", true).order("name"),
    supabase.from("feedback").select("id, kind, title, status, admin_note, created_at").eq("profile_id", me.id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("created_at, last_seen_at").eq("id", me.id).single(),
  ])
  const stats = tab === "stats" ? await myStats(me.id) : null

  return (
    <div className="space-y-8">
      <PageHeader title="Options" description="Your preferences, what you've done in the app, and a direct line to suggest features or report bugs." />

      <nav className="flex flex-wrap gap-1 border-b pb-3" aria-label="Options sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/options${t.key === "preferences" ? "" : `?tab=${t.key}`}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("rounded-full px-3.5 py-1.5 text-sm transition-colors", tab === t.key ? "bg-lime font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "preferences" && (
        <PreferencesForm
          clients={clients ?? []}
          defaults={{
            default_days: me.preferences?.default_days ?? 30,
            optimise_order: me.preferences?.optimise_order ?? "claude",
            start_page: me.preferences?.start_page ?? "clients",
            animations: me.preferences?.animations !== false,
            layout: newLayout(me.preferences) ? "new" : "classic",
            lens: lensOf(me.preferences, me.role),
          }}
        />
      )}

      {tab === "stats" && stats && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Member since {longDate((profile?.created_at ?? "").slice(0, 10))} · {lastActive(profile?.last_seen_at)}
            {stats.called > 0 && (
              <>
                {" "}
                · {stats.proven} of your {stats.called} called tests were proven
              </>
            )}
          </p>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-5">
            {stats.stats.map((s) => (
              <div key={s.key} className="bg-card px-4 py-4">
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className="mt-1 font-heading text-3xl leading-none tabular-nums">{s.total}</dd>
                <dd className={cn("mt-2 text-xs tabular-nums", s.last30 ? "text-lime" : "text-muted-foreground")}>{s.last30 ? `+${s.last30} in the last 30 days` : "None in the last 30 days"}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {(tab === "feature" || tab === "bug") && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <FeedbackForm kind={tab} />
          <section className="surface divide-y self-start">
            <h3 className="px-5 py-3 text-sm font-semibold">What you&apos;ve sent</h3>
            {(mine ?? []).length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">Nothing yet.</p>}
            {(mine ?? []).map((f) => (
              <div key={f.id} className="space-y-1 px-5 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="mr-1.5 text-xs text-muted-foreground">{f.kind === "bug" ? "Bug" : "Idea"}</span>
                    {f.title}
                  </span>
                  <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px]", FEEDBACK_STATUS[f.status]?.cls)}>{FEEDBACK_STATUS[f.status]?.label ?? f.status}</span>
                </div>
                {f.admin_note && <p className="text-xs text-muted-foreground">Reply: {f.admin_note}</p>}
                <p className="text-[11px] text-muted-foreground">{longDate(f.created_at.slice(0, 10))}</p>
              </div>
            ))}
            {isAdmin(me) && (
              <Link href="/admin/feedback" className="block px-5 py-3 text-xs text-muted-foreground hover:text-foreground">
                Everyone&apos;s feedback is in Admin → Feedback →
              </Link>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
