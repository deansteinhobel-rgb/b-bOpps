import { GoalSummary } from "../_glance/glance-board"
import { GlanceCard } from "../_glance/glance-card"
import { GoalCard, type GoalView } from "../_glance/goal-card"

/**
 * The client's main goals from outside the ad platforms (DNSFilter: activated non-PLG free trials), beside
 * the read's verdict, stacked: this month so far against pace. Click one to update this month's figure.
 */
export function GoalsRow({ slug, goals, canEdit }: { slug: string; goals: GoalView[]; canEdit: boolean }) {
  if (!goals.length) return null
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
      {goals.map((g) => (
        <GlanceCard
          key={g.id}
          id={`goal-${g.id}`}
          title={g.name}
          meta={`${g.monthLabel} so far`}
          summary={<GoalSummary goal={g} />}
          detailTitle={g.name}
          detailDescription="The client's main goal this month, from outside the ad platforms. Updated by hand."
          detail={<GoalCard slug={slug} goal={g} canEdit={canEdit} />}
          wide={false}
        />
      ))}
    </section>
  )
}
