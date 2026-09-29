import Link from "next/link"
import { Avatar } from "@/components/brand"
import { FEEDBACK_STATUS } from "@/lib/feedback"
import { longDate } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { TriageForm } from "./triage-form"

export const metadata = { title: "Feedback" }

/** Everyone's feature ideas and bug reports, newest first, with a status and a reply the sender sees. */
export default async function FeedbackAdminPage({ searchParams }: PageProps<"/admin/feedback">) {
  const { show } = await searchParams
  const supabase = await createClient()
  const { data } = await supabase.from("feedback").select("id, kind, title, details, page_url, status, admin_note, created_at, profiles(id, full_name, email, avatar_url)").order("created_at", { ascending: false }).limit(300)
  const all = data ?? []
  const open = all.filter((f) => !["done", "wont_do"].includes(f.status))
  const list = show === "all" ? all : open
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Feedback</h1>
          <p className="mt-1 text-sm text-muted-foreground">Feature ideas and bug reports from Options. The sender sees the status and your reply.</p>
        </div>
        <Link href={show === "all" ? "/admin/feedback" : "/admin/feedback?show=all"} className="text-sm text-muted-foreground hover:text-foreground">
          {show === "all" ? `Show open only (${open.length})` : `Show all (${all.length})`}
        </Link>
      </div>
      <ul className="surface divide-y">
        {list.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing open. Nice.</li>}
        {list.map((f) => {
          const who = f.profiles as unknown as { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
          return (
            <li key={f.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0 space-y-1.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", f.kind === "bug" ? "border-rag-red/40 bg-rag-red/10 text-rag-red" : "border-lime/40 bg-lime/10 text-lime")}>{f.kind === "bug" ? "Bug" : "Idea"}</span>
                  <strong>{f.title}</strong>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", FEEDBACK_STATUS[f.status]?.cls)}>{FEEDBACK_STATUS[f.status]?.label}</span>
                </p>
                {f.details && <p className="text-sm whitespace-pre-line text-muted-foreground">{f.details}</p>}
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {who && (
                    <Link href={`/people/${who.id}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                      <Avatar name={who.full_name ?? who.email} url={who.avatar_url} className="size-5 text-[9px]" />
                      {who.full_name ?? who.email}
                    </Link>
                  )}
                  · {longDate(f.created_at.slice(0, 10))}
                  {f.page_url && <> · {f.page_url}</>}
                </p>
              </div>
              <TriageForm id={f.id} status={f.status} note={f.admin_note ?? ""} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
