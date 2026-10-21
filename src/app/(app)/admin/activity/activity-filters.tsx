"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { FilterTabs } from "@/components/filter-tabs"
import { fieldClass } from "@/components/field-class"
import { type ActivitySource, SOURCE_LABEL } from "@/lib/activity"
import { cn } from "@/lib/utils"

type Source = ActivitySource | "all"
type Days = "7" | "30" | "90"

/** Source, period, client and person, all in the URL so a view can be shared. */
export function ActivityFilters({ clients, people }: { clients: { id: string; name: string }[]; people: { id: string; name: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    start(() => router.push(`${pathname}?${next}`, { scroll: false }))
  }
  const source = (params.get("source") as Source | null) ?? "all"
  const days = (params.get("days") as Days | null) ?? "7"

  return (
    <div className={pending ? "space-y-3 opacity-70 transition-opacity" : "space-y-3"}>
      <FilterTabs<Source>
        label="Where"
        value={source}
        onChange={(v) => set("source", v === "all" ? null : v)}
        options={[{ value: "all", label: "Everything" }, ...(Object.keys(SOURCE_LABEL) as ActivitySource[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] }))]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs<Days> label="Period" showLabel={false} value={days} onChange={(v) => set("days", v === "7" ? null : v)} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <select aria-label="Client" className={cn(fieldClass, "h-8 w-auto min-w-40")} value={params.get("client") ?? ""} onChange={(e) => set("client", e.target.value || null)}>
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Person" className={cn(fieldClass, "h-8 w-auto min-w-40")} value={params.get("who") ?? ""} onChange={(e) => set("who", e.target.value || null)}>
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
