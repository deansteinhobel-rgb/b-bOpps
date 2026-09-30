import Link from "next/link"
import { notFound } from "next/navigation"
import { AdminForm } from "@/components/admin-form"
import { fieldClass } from "@/components/field-class"
import { PlatformLabel } from "@/components/brand"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { londonToday } from "@/lib/checks/periods"
import { money } from "@/lib/format"
import { PLATFORM_LABEL, type Platform } from "@/lib/metrics/types"
import { createClient } from "@/lib/supabase/server"
import { RESULT_TIERS, suggestTier } from "@/lib/taxonomy"
import { listWindsorAccounts } from "@/lib/windsor/accounts"
import { addAccount, addTeamMember, saveBudgets, saveClient, updateAccount } from "../../actions"
import { ClientFields } from "../client-fields"
import { BackfillButton } from "./backfill-button"
import { RemoveMember } from "./remove-member"

const ROLE: Record<string, string> = { gtm_lead: "GTM lead", am: "Account manager", specialist: "Paid media specialist" }
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

export default async function AdminClientPage({ params }: PageProps<"/admin/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: client } = await supabase.from("clients").select("*").eq("slug", slug).maybeSingle()
  if (!client) notFound()

  const thisMonth = londonToday().slice(0, 8) + "01"
  const months = [thisMonth, nextMonth(thisMonth)]
  const [{ data: allClients }, { data: optionRows }, { data: team }, { data: invites }, { data: accounts }, { data: budgets }, { data: tiers }, windsor] = await Promise.all([
    supabase.from("clients").select("notion_client_option"),
    supabase.from("notion_pages_mirror").select("client_option:properties->>Client").eq("in_trash", false).limit(5000),
    supabase.from("client_team_invites").select("email, role, team_invites(full_name)").eq("client_id", client.id).is("removed_at", null),
    supabase.from("team_invites").select("email, full_name").order("full_name"),
    supabase.from("client_platform_accounts").select("*").eq("client_id", client.id).order("platform"),
    supabase.from("client_budgets").select("platform, month, amount").eq("client_id", client.id).eq("campaign_id", "").in("month", months),
    supabase.from("conversion_field_tiers").select("account_id, field, tier, description").eq("client_id", client.id),
    listWindsorAccounts().catch(() => null),
  ])
  const notionOptions = [...new Set((optionRows ?? []).map((r) => r.client_option as string | null).filter(Boolean) as string[])].sort()
  const taken = new Set((allClients ?? []).map((c) => c.notion_client_option))
  const mapped = new Set((accounts ?? []).map((a) => `${a.platform}|${a.external_account_id}`))
  const platforms = [...new Set((accounts ?? []).filter((a) => a.active).map((a) => a.platform as Platform))]
  const budgetFor = (p: string, m: string) => budgets?.find((b) => b.platform === p && b.month === m)?.amount
  const defaultFor = (p: string) => (accounts ?? []).filter((a) => a.platform === p && a.active).reduce((s, a) => s + Number(a.monthly_budget ?? 0), 0)
  const tierFor = (accountId: string, field: string) => tiers?.find((t) => t.account_id === accountId && t.field === field)
  const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m))

  return (
    <div className="space-y-10">
      <div>
        <Link href="/admin/clients" className="eyebrow hover:text-foreground">
          ← All clients
        </Link>
        <h1 className="mt-2 text-3xl">{client.name}</h1>
        <Link href={`/clients/${slug}`} className="text-sm underline">
          Open client page
        </Link>
      </div>

      <section>
        <h2 className="text-2xl">Details</h2>
        <AdminForm action={saveClient} className="mt-4 max-w-3xl rounded-lg border bg-card p-4">
          <ClientFields values={client} notionOptions={notionOptions} taken={taken} />
        </AdminForm>
      </section>

      <section>
        <h2 className="text-2xl">Team</h2>
        <p className="mt-1 text-sm text-muted-foreground">Team members see this client. Admins and GTM leads see every client anyway.</p>
        <ul className="mt-3 divide-y rounded-lg border bg-card text-sm">
          {(team ?? []).length === 0 && <li className="px-4 py-3 text-muted-foreground">No one yet.</li>}
          {(team ?? []).map((t) => {
            const name = (t.team_invites as unknown as { full_name: string | null } | null)?.full_name ?? t.email
            return (
              <li key={`${t.email}-${t.role}`} className="flex items-center justify-between px-4 py-2">
                <span>
                  {name} · <span className="text-muted-foreground">{ROLE[t.role]}</span>
                </span>
                <RemoveMember clientId={client.id} email={t.email} role={t.role} name={name} />
              </li>
            )
          })}
        </ul>
        <AdminForm action={addTeamMember} submitLabel="Add to team" className="mt-3 flex max-w-3xl flex-wrap items-end gap-3 space-y-0">
          <input type="hidden" name="client_id" value={client.id} />
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="member-email">Person</Label>
            <select id="member-email" name="email" className={fieldClass} defaultValue="">
              <option value="">Pick someone (add new people under People)</option>
              {(invites ?? []).map((i) => (
                <option key={i.email} value={i.email}>
                  {i.full_name ?? i.email}
                </option>
              ))}
            </select>
          </div>
          <div className="w-52 space-y-1">
            <Label htmlFor="member-role">Role on this client</Label>
            <select id="member-role" name="role" className={fieldClass} defaultValue="specialist">
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </AdminForm>
      </section>

      <section>
        <h2 className="text-2xl">Ad accounts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Conversion and lead fields are Windsor field IDs, comma-separated. Results = conversions + leads. Changes apply from the next sync or backfill.
        </p>
        <div className="mt-4 space-y-3">
          {(accounts ?? []).map((a) => (
            <AdminForm key={a.id} action={updateAccount} className="rounded-lg border bg-card p-4">
              <input type="hidden" name="id" value={a.id} />
              <p className="font-bold">
                <PlatformLabel platform={a.platform as Platform} /> · {a.account_name ?? a.external_account_id}{" "}
                <span className="font-normal text-muted-foreground">({a.external_account_id})</span>
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`b-${a.id}`}>Default monthly budget</Label>
                  <Input id={`b-${a.id}`} name="monthly_budget" type="number" min="0" step="1" defaultValue={a.monthly_budget ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`c-${a.id}`}>Conversion fields</Label>
                  <Input id={`c-${a.id}`} name="conversion_fields" defaultValue={(a.conversion_fields as string[]).join(", ")} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`l-${a.id}`}>Lead fields</Label>
                  <Input id={`l-${a.id}`} name="lead_fields" defaultValue={(a.lead_fields as string[]).join(", ")} />
                </div>
              </div>
              {[...(a.conversion_fields as string[]), ...(a.lead_fields as string[])].length > 0 && (
                <div className="space-y-2 rounded-md border border-dashed p-3">
                  <p className="text-sm font-semibold">
                    What each field counts{" "}
                    <span className="font-normal text-muted-foreground">(a standard tier, so results compare across clients)</span>
                  </p>
                  {[...new Set([...(a.conversion_fields as string[]), ...(a.lead_fields as string[])])].map((field) => {
                    const saved = tierFor(a.id, field)
                    const hint = suggestTier(a.platform, field)
                    return (
                      <div key={field} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_minmax(0,1.4fr)]">
                        <code className="truncate text-xs" title={field}>
                          {field}
                        </code>
                        <select name={`tier|${field}`} defaultValue={saved?.tier ?? ""} className={fieldClass} aria-label={`Tier for ${field}`}>
                          <option value="">{hint ? `Not mapped (suggested: ${RESULT_TIERS[hint].label})` : "Not mapped"}</option>
                          {Object.entries(RESULT_TIERS).map(([k, t]) => (
                            <option key={k} value={k} title={t.hint}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <Input name={`tierdesc|${field}`} defaultValue={saved?.description ?? ""} maxLength={200} placeholder="What it is, e.g. demo request form" aria-label={`What ${field} is`} />
                      </div>
                    )
                  })}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={a.active} /> Active (synced and shown)
              </label>
            </AdminForm>
          ))}
        </div>
        <h3 className="mt-6 text-lg">Map another account</h3>
        {windsor === null ? (
          <p className="text-sm text-rag-red">Couldn&apos;t load accounts from Windsor.</p>
        ) : (
          <AdminForm action={addAccount} submitLabel="Map account" className="mt-2 flex max-w-3xl flex-wrap items-end gap-3 space-y-0">
            <input type="hidden" name="client_id" value={client.id} />
            <div className="min-w-72 flex-1 space-y-1">
              <Label htmlFor="acct">Windsor account</Label>
              <select id="acct" name="account" className={fieldClass} defaultValue="">
                <option value="">Pick an account on our Windsor key</option>
                {windsor.map((w) => {
                  const isMapped = mapped.has(`${w.platform}|${w.account_id}`)
                  return (
                    <option key={`${w.connector}-${w.account_id}`} value={`${w.connector}|${w.account_id}|${w.account_name}`} disabled={isMapped}>
                      {PLATFORM_LABEL[w.platform]}: {w.account_name} ({w.account_id}){isMapped ? " (mapped)" : ""}
                    </option>
                  )
                })}
              </select>
            </div>
            <div className="w-44 space-y-1">
              <Label htmlFor="acct-budget">Monthly budget</Label>
              <Input id="acct-budget" name="monthly_budget" type="number" min="0" step="1" />
            </div>
          </AdminForm>
        )}
      </section>

      <section>
        <h2 className="text-2xl">Budgets by month</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pacing uses the month&apos;s budget when set, otherwise the accounts&apos; default monthly budget. Use this for months that differ (e.g. leftover quarterly budget).
        </p>
        {platforms.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Map an ad account first.</p>
        ) : (
          <AdminForm action={saveBudgets} submitLabel="Save budgets" className="mt-4 max-w-3xl rounded-lg border bg-card p-4">
            <input type="hidden" name="client_id" value={client.id} />
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-normal">Platform</th>
                  {months.map((m) => (
                    <th key={m} className="py-1 font-normal">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {platforms.map((p) => (
                  <tr key={p}>
                    <td className="py-1 pr-3">{PLATFORM_LABEL[p]}</td>
                    {months.map((m) => (
                      <td key={m} className="py-1 pr-3">
                        <Input name={`budget|${p}|${m}`} type="number" min="0" step="1" defaultValue={budgetFor(p, m) ?? ""} placeholder={`Default ${money(defaultFor(p), client.currency)}`} aria-label={`${PLATFORM_LABEL[p]} ${monthLabel(m)}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminForm>
        )}
      </section>

      <section>
        <h2 className="text-2xl">Windsor backfill</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">Reloads the last 90 days of numbers for every active account (30 days at a time), then ad previews for the last 14 days. Takes a few minutes. Keep this page open.</p>
        <BackfillButton
          accounts={(accounts ?? []).filter((a) => a.active).map((a) => ({ id: a.id, label: `${PLATFORM_LABEL[a.platform as Platform]} ${a.account_name ?? a.external_account_id}` }))}
        />
      </section>
    </div>
  )
}
