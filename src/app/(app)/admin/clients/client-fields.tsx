import { fieldClass } from "@/components/field-class"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEAL_SIZE_BANDS, INDUSTRIES, REGIONS, SALES_MOTIONS } from "@/lib/taxonomy"

export type ClientValues = {
  id?: string
  name: string
  website?: string | null
  logo_url?: string | null
  slug: string
  notion_client_option: string
  currency: string
  monthly_kpi_target: number | null
  slack_channel: string | null
  active: boolean
  industry?: string | null
  sub_industry?: string | null
  sales_motion?: string | null
  deal_size_band?: string | null
  regions?: string[] | null
}

/** Fields shared by "New client" and "Edit client". Notion options come from the mirrored board. */
export function ClientFields({ values, notionOptions, taken }: { values?: ClientValues; notionOptions: string[]; taken: Set<string> }) {
  const v = values
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {v?.id && <input type="hidden" name="id" value={v.id} />}
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={v?.name} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="slug">Slug (used in links)</Label>
        <Input id="slug" name="slug" defaultValue={v?.slug} required pattern="[a-z0-9-]+" placeholder="e.g. camber" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="notion_client_option">Notion &ldquo;Client&rdquo; option</Label>
        <select id="notion_client_option" name="notion_client_option" defaultValue={v?.notion_client_option ?? ""} className={fieldClass} required>
          <option value="">Pick from Master Production</option>
          {notionOptions.map((o) => (
            <option key={o} value={o} disabled={taken.has(o) && o !== v?.notion_client_option}>
              {o}
              {taken.has(o) && o !== v?.notion_client_option ? " (already a client)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="currency">Currency</Label>
        <Input id="currency" name="currency" defaultValue={v?.currency ?? "USD"} maxLength={3} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="monthly_kpi_target">Target cost per result</Label>
        <Input id="monthly_kpi_target" name="monthly_kpi_target" type="number" min="0" step="0.01" defaultValue={v?.monthly_kpi_target ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="slack_channel">Slack channel (on hold)</Label>
        <Input id="slack_channel" name="slack_channel" defaultValue={v?.slack_channel ?? ""} placeholder="#client-camber" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="website">Website</Label>
        <Input id="website" name="website" defaultValue={v?.website ?? ""} placeholder="dnsfilter.com" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="logo_url">Logo URL (optional)</Label>
        <Input id="logo_url" name="logo_url" defaultValue={v?.logo_url?.includes("/brand/") ? "" : (v?.logo_url ?? "")} placeholder="Leave blank to use the website's icon" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={v?.active ?? true} /> Active
      </label>

      <fieldset className="space-y-3 border-t pt-4 sm:col-span-2">
        <legend className="sr-only">Labels for comparing clients</legend>
        <div>
          <p className="text-sm font-semibold">Labels for comparing clients</p>
          <p className="text-xs text-muted-foreground">Used to compare what works across clients (by industry, sales motion, deal size and market). Fixed lists, so they line up.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="industry">Industry</Label>
            <select id="industry" name="industry" defaultValue={v?.industry ?? ""} className={fieldClass}>
              <option value="">Not set</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sub_industry">Niche (optional)</Label>
            <Input id="sub_industry" name="sub_industry" defaultValue={v?.sub_industry ?? ""} maxLength={120} placeholder="e.g. DNS security for MSPs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sales_motion">Sales motion</Label>
            <select id="sales_motion" name="sales_motion" defaultValue={v?.sales_motion ?? ""} className={fieldClass}>
              <option value="">Not set</option>
              {Object.entries(SALES_MOTIONS).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}: {m.hint}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="deal_size_band">Typical deal size (annual contract value, in $)</Label>
            <select id="deal_size_band" name="deal_size_band" defaultValue={v?.deal_size_band ?? ""} className={fieldClass}>
              <option value="">Not set</option>
              {Object.entries(DEAL_SIZE_BANDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm">Markets they sell into</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(REGIONS).map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm has-checked:border-lime has-checked:bg-lime has-checked:text-ink">
                <input type="checkbox" className="sr-only" name="regions" value={k} defaultChecked={v?.regions?.includes(k)} />
                {label}
              </label>
            ))}
          </div>
        </div>
      </fieldset>
    </div>
  )
}
