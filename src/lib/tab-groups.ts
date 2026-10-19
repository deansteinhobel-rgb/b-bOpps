// One layout for everyone (Dean, 2026-10-15): the Hands-on / Overview lenses and the classic layout are
// gone. What a person can do depends on their role (src/lib/auth.ts), never on what they see.
// A plain module: used by server and client components.
//
// Names (Dean, 2026-10-15: the old ones, "Do", "Know", "Optimize now", meant nothing without context):
// each section says what's in it. Labels only: every URL stays as it was (Notion links point at them).

/** A client section and its pages. A section with several pages shows them as a sub-navigation. */
export type TabGroup = { key: string; label: string; items: { href: string; label: string }[] }

const SUMMARY: TabGroup = { key: "summary", label: "Summary", items: [{ href: "", label: "Summary" }] }
const TASKS: TabGroup = {
  key: "tasks",
  label: "Tasks",
  items: [
    { href: "/do", label: "All tasks" },
    { href: "/insights", label: "Recommendations" },
    { href: "/checks", label: "QA checks" },
  ],
}
const REPORTING: TabGroup = {
  key: "reporting",
  label: "Reporting",
  items: [
    { href: "/reporting", label: "Dashboard" },
    // Dean, 2026-10-19: the step-by-step report the team shares with the client.
    { href: "/reporting/client-report", label: "Client report" },
  ],
}
const PLANNING: TabGroup = {
  key: "planning",
  label: "Planning",
  items: [
    { href: "/sprint", label: "Sprint tests" },
    { href: "/ideas", label: "Content ideas" },
    { href: "/library", label: "Content library" },
    { href: "/briefs", label: "Notion briefs" },
  ],
}
const KNOWLEDGE: TabGroup = { key: "knowledge", label: "Knowledge", items: [{ href: "/brain", label: "Client brain" }] }

/** Every section, apart from the content library, which only shows for clients that have one (src/lib/content-library/config.ts). */
export const tabGroups = (opts: { contentLibrary?: boolean } = {}): TabGroup[] => {
  const planning = opts.contentLibrary ? PLANNING : { ...PLANNING, items: PLANNING.items.filter((i) => i.href !== "/library") }
  return [SUMMARY, TASKS, REPORTING, planning, KNOWLEDGE]
}

/** Every client page by its new name, for Jump to (⌘K). */
export const CLIENT_PAGES = tabGroups({ contentLibrary: true }).flatMap((g) => g.items)
