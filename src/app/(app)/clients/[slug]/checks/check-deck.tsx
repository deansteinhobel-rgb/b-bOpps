"use client"

import { useRef, useState } from "react"
import { ParticleAmpersand } from "@/components/fx/particle-ampersand"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import { CheckCard } from "./check-card"

type CardProps = Omit<React.ComponentProps<typeof CheckCard>, "onSaved" | "extraActions">

/**
 * Checks as a stacked deck: the current check in front, the next ones peeking out behind. Saving
 * sends the card away and brings the next one forward. Done checks sit in a pile you can reopen.
 * A list view shows everything at once.
 */
export function CheckDeck({ title, subtitle, items }: { title: string; subtitle: string; items: CardProps[] }) {
  // Order: the server's pending checks, minus ones just saved here (until the refresh lands),
  // with skipped checks moved to the back. Derived, so it always matches the latest data.
  const [skipped, setSkipped] = useState<string[]>([])
  const [savedHere, setSavedHere] = useState<string[]>([])
  const [leaving, setLeaving] = useState<string | null>(null)
  const pendingIds = items.filter((i) => i.result.status === null && !savedHere.includes(i.result.id)).map((i) => i.result.id)
  const queue = [...pendingIds.filter((id) => !skipped.includes(id)), ...skipped.filter((id) => pendingIds.includes(id))]
  const [reopened, setReopened] = useState<string | null>(null)
  const [view, setView] = useState<"deck" | "list">("deck")
  const deckRef = useRef<HTMLDivElement>(null)

  const byId = new Map(items.map((i) => [i.result.id, i]))
  const frontId = reopened ?? queue.find((id) => byId.has(id)) ?? null
  const front = frontId ? byId.get(frontId) : undefined
  const upNext = queue.filter((id) => id !== frontId && byId.has(id)).slice(0, 2)
  const done = items.filter((i) => (i.result.status !== null || savedHere.includes(i.result.id)) && i.result.id !== reopened)
  const total = items.length
  const doneCount = items.filter((i) => i.result.status !== null || savedHere.includes(i.result.id)).length

  const onSaved = () => {
    if (!frontId) return
    setLeaving(frontId)
    setTimeout(() => {
      if (reopened) setReopened(null)
      else setSavedHere((s) => [...s, frontId])
      setLeaving(null)
    }, 350)
  }
  const skip = () => frontId && !reopened && setSkipped((s) => [...s.filter((id) => id !== frontId), frontId])
  const reopen = (id: string) => {
    setReopened(id)
    setView("deck")
    deckRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <section className="space-y-5" ref={deckRef}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h2 className="mt-1 text-2xl">{title}</h2>
        </div>
        <div className="flex items-center gap-4">
          <Progress done={doneCount} total={total} />
          <div className="flex rounded-full border bg-card p-0.5 text-xs">
            {(["deck", "list"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-full px-3 py-1 capitalize", view === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {v === "deck" ? "Cards" : "List"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "list" ? (
        <div className="space-y-4">
          {items.map((p) => (
            <CheckCard key={p.result.id} {...p} />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          {/* The deck */}
          <div>
            {front ? (
              <div className="relative">
                <p className="mb-2 text-xs text-muted-foreground">
                  {reopened ? "Editing a completed check" : `Check ${doneCount + 1} of ${total}`}
                  {!reopened && upNext.length > 0 && ` · up next: ${byId.get(upNext[0])!.definition.name}`}
                </p>
                <div key={front.result.id} className={cn("relative z-20", leaving === front.result.id ? "deck-out" : "deck-in")}>
                  <CheckCard
                    {...front}
                    onSaved={onSaved}
                    extraActions={
                      reopened ? (
                        <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setReopened(null)}>
                          Back to the deck
                        </button>
                      ) : upNext.length > 0 ? (
                        <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={skip}>
                          Skip for now
                        </button>
                      ) : null
                    }
                  />
                </div>
                {/* Cards peeking out behind */}
                {!reopened &&
                  upNext.map((id, i) => (
                    <div
                      key={id}
                      aria-hidden
                      className={cn("relative -mt-2 rounded-b-xl border border-t-0 bg-card px-5 pt-3 pb-2 text-xs text-muted-foreground", i === 0 ? "z-10 mx-4 opacity-80" : "z-0 mx-8 opacity-50")}
                    >
                      <span className="line-clamp-1">{byId.get(id)!.definition.name}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <AllDone total={total} />
            )}
          </div>

          {/* Done pile */}
          <aside className="space-y-2">
            <p className="text-xs text-muted-foreground">Done ({done.length})</p>
            {done.length === 0 ? (
              <p className="surface px-3 py-4 text-center text-xs text-subtle-foreground">Completed checks land here.</p>
            ) : (
              <ul className="surface divide-y overflow-hidden">
                {done.map((d) => (
                  <li key={d.result.id}>
                    <button type="button" onClick={() => reopen(d.result.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent/50">
                      <span className="line-clamp-1">{d.definition.name}</span>
                      {d.result.status && <StatusBadge status={d.result.status} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`${done} of ${total} done`}>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-1.5 w-3 rounded-full", i < done ? "bg-lime" : "bg-secondary")} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
    </div>
  )
}

function AllDone({ total }: { total: number }) {
  return (
    <div className="surface relative flex min-h-72 flex-col items-center justify-center overflow-hidden px-6 py-10 text-center">
      <ParticleAmpersand className="absolute inset-y-4 right-4 w-48 opacity-70 sm:w-64" />
      <div className="relative">
        <p className="font-heading text-3xl">All {total} checks done</p>
        <p className="mt-2 text-sm text-muted-foreground">Nice work. Hover the &amp; if you&apos;ve got a second to spare.</p>
      </div>
    </div>
  )
}
