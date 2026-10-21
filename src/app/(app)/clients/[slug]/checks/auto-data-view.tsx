import { AdThumb } from "@/components/ad-thumb"
import { StatusBadge, StatusDot } from "@/components/status-badge"
import type { AutoData } from "@/lib/checks/auto-data"
import { longDate } from "@/lib/format"
import type { PreviewMap } from "@/lib/previews"

export function AutoDataView({ data, label, previews }: { data: AutoData; label: string; previews?: PreviewMap }) {
  const withThumbs = Boolean(data.adKeys?.some(Boolean) && previews)
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
                {withThumbs && <th className="w-12 py-1 pr-2 font-normal" aria-label="Preview" />}
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
                  {withThumbs && (
                    <td className="py-1 pr-2">
                      {data.adKeys?.[i] ? <AdThumb preview={previews?.[data.adKeys[i]!]} alt="Ad preview" size="sm" /> : null}
                    </td>
                  )}
                  {row.map((cell, j) => (
                    <td key={j} className={j === 0 ? "max-w-64 truncate py-1 pr-3" : "py-1 pr-3 tabular-nums"} title={typeof cell === "string" && cell.startsWith("rag:") ? cell.slice(4) : String(cell)}>
                      {typeof cell === "string" && cell.startsWith("rag:") ? <StatusDot status={cell.slice(4) as "green"} /> : cell}
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
