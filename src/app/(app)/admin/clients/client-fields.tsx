import { fieldClass } from "@/components/admin-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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
    </div>
  )
}
