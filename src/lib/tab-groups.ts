// One layout for everyone (Dean, 2026-10-15): the Hands-on / Overview lenses and the classic layout are
// gone. What a person can do depends on their role (src/lib/auth.ts), never on what they see.
// A plain module: used by server and client components.

/** A client's tab groups. Every existing URL stays where it was; the groups only gather them. */
export type TabGroup = { key: string; label: string; items: { href: string; label: string }[] }

const OVERVIEW: TabGroup = { key: "overview", label: "Overview", items: [{ href: "", label: "At a glance" }] }
const DO: TabGroup = {
  key: "do",
  label: "Do",
  items: [
    { href: "/do", label: "To do" },
    { href: "/insights", label: "Optimize now" },
    { href: "/checks", label: "Checks" },
  ],
}
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

/** Every tab, apart from the content library, which only shows for clients that have one (src/lib/content-library/config.ts). */
export const tabGroups = (opts: { contentLibrary?: boolean } = {}): TabGroup[] => {
  const plan = opts.contentLibrary ? PLAN : { ...PLAN, items: PLAN.items.filter((i) => i.href !== "/library") }
  return [OVERVIEW, DO, PERFORMANCE, plan, KNOW]
}
