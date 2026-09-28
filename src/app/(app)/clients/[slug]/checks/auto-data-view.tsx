import { StatusBadge } from "@/components/status-badge"
import type { AutoData } from "@/lib/checks/auto-data"
import { longDate } from "@/lib/format"

export function AutoDataView({ data, label }: { data: AutoData; label: string }) {
  return (
    <div className="rounded-md border bg-secondary/50 p-3 text-sm">
      <p className="eyebrow">
        {label} · data through {longDate(data.dataThrough)}
      </p>
      {data.note && <p className="mt-1 text-muted-foreground">{data.note}</p>}
      {data.facts && data.facts.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          {data.facts.map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="flex items-center gap-2 tabular-nums">
                {f.value}
                {f.status && <StatusBadge status={f.status} />}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {data.table && data.table.rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                {data.table.columns.map((c) => (
                  <th key={c} className="py-1 pr-3 font-normal">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.table.rows.map((row, i) => (
                <tr key={i} className="border-t border-border/60">
                  {row.map((cell, j) => (
                    <td key={j} className={j === 0 ? "max-w-64 truncate py-1 pr-3" : "py-1 pr-3 tabular-nums"} title={String(cell)}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
