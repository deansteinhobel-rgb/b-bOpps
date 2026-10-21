import Link from "next/link"
import { PlatformIcon } from "@/components/brand"
import { shortDate } from "@/lib/format"
import type { Platform } from "@/lib/metrics/types"
import { sprintByNumber, sprintDay, SPRINT_DAYS, type sprintOf } from "@/lib/sprints/periods"
import type { TimelineEntry } from "@/lib/timeline"
import { StagePill } from "./glance-board"
import type { Plans } from "./glance-data"
import { Timeline } from "./timeline"

/** "What's changed" in full: inline in the classic layout, in the side panel in the new one. */
export function ChangesDetail({ timeline, recent, by }: { timeline: TimelineEntry[]; recent: TimelineEntry[]; by: { team: number; platform: number; app: number } }) {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        {recent.length === 0 ? (
          <span className="text-muted-foreground">Nothing changed in the last 7 days.</span>
        ) : (
          <>
            <span className="font-medium">
              {recent.length} change{recent.length === 1 ? "" : "s"} in the last 7 days
            </span>
            <span className="text-muted-foreground">: {[by.team && `${by.team} logged by the team`, by.platform && `${by.platform} on the platforms`, by.app && `${by.app} in the app`].filter(Boolean).join(", ")}.</span>
          </>
        )}
      </p>
      <Timeline entries={timeline} pageSize={20} />
    </div>
  )
}

/** "What's planned" in full: this sprint's tests by stage, the next sprint and how the last one ended. */
export function PlansDetail({ slug, period, today, plans }: { slug: string; period: ReturnType<typeof sprintOf>; today: string; plans: Plans }) {
  const { now, nextTests, prevTests, previous } = plans
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="surface overflow-hidden">
        <div className="space-y-2 border-b px-5 py-4">
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              This sprint: Sprint {period.number} · {shortDate(period.start)} – {shortDate(period.end)}
            </span>
            <span className="text-xs text-muted-foreground">
              Day {sprintDay(period, today)} of {SPRINT_DAYS}
            </span>
          </p>
          <span className="block h-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
            <span className="block h-full rounded-full bg-foreground/50" style={{ width: `${(sprintDay(period, today) / SPRINT_DAYS) * 100}%` }} />
          </span>
        </div>
        {now.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nothing planned yet for this sprint.</p>
        ) : (
          <ul className="divide-y">
            {now.map((t) => (
              <li key={t.id}>
                <Link href={`/clients/${slug}/sprint#test-${t.id}`} className="flex items-start gap-3 px-5 py-3 text-sm hover:bg-secondary/30">
                  <PlatformIcon platform={(t.platform as Platform) ?? null} className="mt-0.5 size-4" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 leading-snug">{t.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {[t.owner_name, t.outcome ? t.outcome.charAt(0).toUpperCase() + t.outcome.slice(1) : t.live_on ? `live since ${shortDate(t.live_on)}` : t.deadline ? `due ${shortDate(t.deadline)}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <StagePill stage={t.stage} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-4">
        <div className="surface p-5 text-sm">
          <p className="font-medium">Next: Sprint {period.number + 1}</p>
          <p className="text-xs text-muted-foreground">Starts {shortDate(sprintByNumber(period.number + 1).start)}</p>
          {nextTests.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-4">
              {nextTests.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-muted-foreground">Nothing planned yet. Carried-over tests and new plans appear here.</p>
          )}
        </div>
        {previous && (
          <div className="surface p-5 text-sm">
            <p className="font-medium">Last: Sprint {previous.number}</p>
            <p className="text-xs text-muted-foreground">
              {prevTests.filter((t) => t.outcome === "proven").length} worked · {prevTests.filter((t) => t.outcome === "disproven").length} didn&apos;t · {prevTests.filter((t) => t.outcome === "carried").length} carried over
            </p>
            {previous.key_takeaway && <p className="mt-3">{previous.key_takeaway}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
