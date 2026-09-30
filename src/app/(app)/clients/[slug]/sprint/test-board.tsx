import { STAGE_STYLE } from "@/lib/sprints/stage-style"
import { STAGES, type Stage } from "@/lib/sprints/tests"
import { cn } from "@/lib/utils"

/**
 * The sprint's tests as a board (Dean, 2026-09-30). From lg up it's a kanban: columns that have
 * tests share the width and empty ones shrink to a slim placeholder. Below lg the stages stack as
 * sections (empty ones hidden), cards two across from sm. Done tests sit in a grid underneath.
 */
export function TestBoard<T extends { id: string }>({ items, card }: { items: { t: T; stage: Stage }[]; card: (t: T, stage: Stage) => React.ReactNode }) {
  const inStage = (s: Stage) => items.filter((x) => x.stage === s)
  const done = inStage("done")
  return (
    <>
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-3 lg:overflow-x-auto lg:pb-2">
        {STAGES.filter((s) => s.key !== "done").map((s) => {
          const here = inStage(s.key)
          return (
            <section key={s.key} aria-label={s.label} className={cn("flex flex-col gap-2", here.length ? "lg:min-w-[14.5rem] lg:flex-1" : "max-lg:hidden lg:w-32 lg:flex-none")}>
              <StageHeader stage={s.key} label={s.label} hint={s.hint} count={here.length} />
              <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:min-h-40 lg:flex-col lg:rounded-xl lg:bg-secondary/30 lg:p-2">
                {here.length ? here.map(({ t, stage }) => card(t, stage)) : <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{STAGE_STYLE[s.key].empty}</p>}
              </div>
            </section>
          )
        })}
      </div>
      {done.length > 0 && (
        <section aria-label="Done" className="space-y-2 pt-2">
          <StageHeader stage="done" label="Done" hint="Called or carried over" count={done.length} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{done.map(({ t, stage }) => card(t, stage))}</div>
        </section>
      )}
    </>
  )
}

/** A column's head: stage colour, name, count and what happens there, over a colour rule. */
function StageHeader({ stage, label, hint, count }: { stage: Stage; label: string; hint: string; count: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STAGE_STYLE[stage].dot)} />
        <h3 className="text-sm font-semibold whitespace-nowrap">{label}</h3>
        <span className="rounded-full bg-secondary px-1.5 text-[11px] text-muted-foreground tabular-nums">{count}</span>
        {count > 0 && hint && <span className="ml-auto truncate text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div aria-hidden className={cn("h-0.5 rounded-full", STAGE_STYLE[stage].bar)} />
    </div>
  )
}
