/**
 * Parses seed/checks.md into check_definitions rows. Each check is a `### key: Name` heading
 * followed by `- Field: value` lines. Indented lines continue the previous field.
 */
const FIELDS: Record<string, string> = {
  cadence: "cadence",
  owner: "owner_role",
  "pre-loaded": "pre_loaded",
  instructions: "instructions",
  "what to record": "what_to_record",
  "not applicable when": "not_applicable_when",
  "flag immediately when": "flag_immediately_when",
  guide: "guide",
}
const OWNERS: Record<string, string> = { specialist: "specialist", am: "am", "gtm lead": "gtm_lead" }

export type CheckRow = {
  key: string
  name: string
  cadence: "weekly" | "monthly"
  owner_role: string
  pre_loaded: string | null
  instructions: string
  what_to_record: string | null
  not_applicable_when: string | null
  flag_immediately_when: string | null
  guide: string | null
  sort_order: number
}

export function parseChecks(md: string): CheckRow[] {
  const rows: CheckRow[] = []
  let current: Record<string, string> | null = null
  let field: string | null = null

  const finish = () => {
    if (!current) return
    const key = current.key
    for (const required of ["cadence", "owner_role", "instructions"]) {
      if (!current[required]) throw new Error(`checks.md: "${key}" is missing "${required}"`)
    }
    const cadence = current.cadence.toLowerCase()
    if (cadence !== "weekly" && cadence !== "monthly") throw new Error(`checks.md: "${key}" cadence must be weekly or monthly`)
    const owner = OWNERS[current.owner_role.toLowerCase()]
    if (!owner) throw new Error(`checks.md: "${key}" owner must be Specialist, AM or GTM lead`)
    const text = (k: string) => (current![k]?.trim() ? current![k].trim() : null)
    rows.push({
      key,
      name: current.name,
      cadence,
      owner_role: owner,
      pre_loaded: text("pre_loaded"),
      instructions: current.instructions.trim(),
      what_to_record: text("what_to_record"),
      not_applicable_when: text("not_applicable_when"),
      flag_immediately_when: text("flag_immediately_when"),
      guide: text("guide"),
      sort_order: (rows.length + 1) * 10,
    })
  }

  for (const line of md.split(/\r?\n/)) {
    const heading = line.match(/^###\s+([a-z0-9_]+):\s*(.+)$/)
    if (heading) {
      finish()
      current = { key: heading[1], name: heading[2].trim() }
      field = null
      continue
    }
    if (!current) continue
    if (/^#{1,2}\s/.test(line) || line.trim() === "---") {
      finish()
      current = null
      continue
    }
    const f = line.match(/^- ([A-Za-z -]+):\s?(.*)$/)
    if (f && FIELDS[f[1].toLowerCase()]) {
      field = FIELDS[f[1].toLowerCase()]
      current[field] = f[2]
    } else if (field && line.trim()) {
      current[field] += "\n" + line.replace(/^ {2}/, "")
    }
  }
  finish()
  return rows
}
