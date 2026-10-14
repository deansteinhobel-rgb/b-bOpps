// The new layout (Dean, 2026-09-30): two lenses on the same app, nothing hidden or locked.
//   Hands-on: people working in the ad platforms. Home is the Today queue; client pages open on "Do".
//   Overview: people reading performance, asking questions and planning. Client pages open on the overview.
// The default for everyone since 2026-10-01 (Dean). `preferences.layout` = "classic" in Options brings
// back the old layout with no deploy. A plain module: used by server and client components.

export type Lens = "hands_on" | "overview"
export type LayoutChoice = "classic" | "new"

export const LENS_LABEL: Record<Lens, string> = { hands_on: "Hands-on", overview: "Overview" }

type Prefs = { layout?: LayoutChoice; lens?: Lens } | null | undefined

export const newLayout = (prefs: Prefs) => prefs?.layout !== "classic"

/** Your chosen lens, else from your role: paid media specialists work hands-on, everyone else starts on the overview. */
export const lensOf = (prefs: Prefs, role: string | null): Lens => prefs?.lens ?? (role === "specialist" ? "hands_on" : "overview")

/** A client's tab groups (new layout). Every existing URL stays where it was; the groups only gather them. */
export type TabGroup = { key: string; label: string; items: { href: string; label: string }[] }

const DO: TabGroup = {
  key: "do",
  label: "Do",
  items: [
    { href: "/do", label: "To do" },
    { href: "/insights", label: "Optimize now" },
    { href: "/checks", label: "Checks" },
  ],
}
const OVERVIEW: TabGroup = { key: "overview", label: "Overview", items: [{ href: "", label: "At a glance" }] }
const PERFORMANCE: TabGroup = { key: "performance", label: "Performance", items: [{ href: "/reporting", label: "Reporting" }] }
const PLAN: TabGroup = {
  key: "plan",
  label: "Plan",
  items: [
    { href: "/sprint", label: "Sprint" },
    { href: "/ideas", label: "Content ideas" },
    { href: "/library", label: "Content library" },
    { href: "/briefs", label: "Briefs" },
  ],
}
const KNOW: TabGroup = { key: "know", label: "Know", items: [{ href: "/brain", label: "Brain" }] }

/**
 * Hands-on puts Do first; Overview puts it last. Both lenses have every tab, apart from the content
 * library, which only shows for clients that have one (src/lib/content-library/config.ts).
 */
export const tabGroups = (lens: Lens, opts: { contentLibrary?: boolean } = {}): TabGroup[] => {
  const plan = opts.contentLibrary ? PLAN : { ...PLAN, items: PLAN.items.filter((i) => i.href !== "/library") }
  return lens === "hands_on" ? [DO, OVERVIEW, PERFORMANCE, plan, KNOW] : [OVERVIEW, PERFORMANCE, plan, KNOW, DO]
}

/** Where a client link opens for this lens. */
export const clientHome = (slug: string, lens: Lens) => `/clients/${slug}${lens === "hands_on" ? "/do" : ""}`
