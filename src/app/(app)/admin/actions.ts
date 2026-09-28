"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { CONNECTORS, DEFAULT_FIELDS } from "@/lib/windsor/accounts"
import { syncCreatives } from "@/lib/windsor/creatives"
import { syncWindsor } from "@/lib/windsor/sync"

// Every action here: admin check in code, and RLS admin policies in the database. No deletes:
// removing someone from a team sets removed_at, so the history stays.

export type FormState = { ok: boolean; message: string } | null

const domain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "bordeauxandburgundy.co.uk").toLowerCase()
const optionalNumber = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().nonnegative().nullable())
const fields = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
const fail = (message: string): FormState => ({ ok: false, message })

// ── Clients ────────────────────────────────────────────────────────────────
const ClientInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required"),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, "Slug: lowercase letters, numbers and dashes"),
  notion_client_option: z.string().trim().min(1, "Pick the Notion Client option"),
  currency: z.string().trim().length(3).toUpperCase(),
  monthly_kpi_target: optionalNumber,
  slack_channel: z.string().trim().optional().transform((v) => v || null),
  active: z.boolean(),
})

export async function saveClient(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  const parsed = ClientInput.safeParse({
    id: form.get("id") || undefined,
    name: form.get("name"),
    slug: form.get("slug"),
    notion_client_option: form.get("notion_client_option"),
    currency: form.get("currency") || "USD",
    monthly_kpi_target: form.get("monthly_kpi_target"),
    slack_channel: form.get("slack_channel") ?? "",
    active: form.get("active") === "on",
  })
  if (!parsed.success) return fail(parsed.error.issues[0].message)
  const { id, ...values } = parsed.data
  const supabase = await createClient()
  const { data: saved, error } = id
    ? await supabase.from("clients").update(values).eq("id", id).select("id").single()
    : await supabase.from("clients").insert({ ...values, main_kpi: "cost_per_result" }).select("id").single()
  if (error || !saved) return fail(error?.code === "23505" ? "That slug or Notion Client option is already used by another client." : (error?.message ?? "Couldn't save."))

  // Re-link mirrored Notion pages to this client's option now, rather than waiting for a full sync.
  // (Mirror rows are server-written only, hence the admin client. Our database only: Notion isn't touched.)
  const admin = createAdminClient()
  await admin.from("notion_pages_mirror").update({ client_id: null }).eq("client_id", saved.id).neq("properties->>Client", values.notion_client_option)
  await admin.from("notion_pages_mirror").update({ client_id: saved.id }).eq("properties->>Client", values.notion_client_option)
  revalidatePath("/admin/clients")
  revalidatePath("/clients")
  if (!id) redirect(`/admin/clients/${values.slug}`)
  return { ok: true, message: "Saved." }
}

// ── Team ───────────────────────────────────────────────────────────────────
export async function addTeamMember(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  const clientId = String(form.get("client_id"))
  const email = String(form.get("email") ?? "").toLowerCase()
  const role = z.enum(["gtm_lead", "am", "specialist"]).safeParse(form.get("role"))
  if (!email || !role.success) return fail("Pick a person and a role.")
  const supabase = await createClient()
  const { data: invite } = await supabase.from("team_invites").select("email").eq("email", email).maybeSingle()
  if (!invite) return fail("Add them under People first.")
  const { error } = await supabase.from("client_team_invites").upsert({ client_id: clientId, email, role: role.data, removed_at: null }, { onConflict: "client_id,email,role" })
  if (error) return fail(error.message)
  const { data: profile } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle()
  if (profile) {
    const { error: e2 } = await supabase.from("client_team").upsert({ client_id: clientId, profile_id: profile.id, role: role.data, removed_at: null }, { onConflict: "client_id,profile_id,role" })
    if (e2) return fail(e2.message)
  }
  revalidatePath("/admin/clients", "layout")
  return { ok: true, message: "Added to the team." }
}

export async function removeTeamMember(clientId: string, email: string, role: string): Promise<FormState> {
  await requireAdmin()
  const supabase = await createClient()
  const now = new Date().toISOString()
  await supabase.from("client_team_invites").update({ removed_at: now }).eq("client_id", clientId).eq("email", email).eq("role", role)
  const { data: profile } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle()
  if (profile) await supabase.from("client_team").update({ removed_at: now }).eq("client_id", clientId).eq("profile_id", profile.id).eq("role", role)
  revalidatePath("/admin/clients", "layout")
  return { ok: true, message: "Removed from the team (kept in history)." }
}

// ── Ad accounts and budgets ────────────────────────────────────────────────
export async function addAccount(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  const [connector, accountId, ...nameParts] = String(form.get("account") ?? "").split("|")
  const platform = CONNECTORS.find((c) => c.connector === connector)?.platform
  if (!platform || !accountId) return fail("Pick a Windsor account.")
  const budget = optionalNumber.safeParse(form.get("monthly_budget"))
  if (!budget.success) return fail("Budget must be a number.")
  const supabase = await createClient()
  const { error } = await supabase.from("client_platform_accounts").insert({
    client_id: String(form.get("client_id")),
    platform,
    windsor_connector: connector,
    external_account_id: accountId,
    account_name: nameParts.join("|") || null,
    monthly_budget: budget.data,
    ...DEFAULT_FIELDS[connector],
  })
  if (error) return fail(error.code === "23505" ? "That account is already mapped (to this or another client)." : error.message)
  revalidatePath("/admin/clients", "layout")
  return { ok: true, message: "Account mapped. Run a backfill to load its history." }
}

export async function updateAccount(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  const budget = optionalNumber.safeParse(form.get("monthly_budget"))
  if (!budget.success) return fail("Budget must be a number.")
  const supabase = await createClient()
  const { error } = await supabase
    .from("client_platform_accounts")
    .update({
      monthly_budget: budget.data,
      conversion_fields: fields(form.get("conversion_fields")),
      lead_fields: fields(form.get("lead_fields")),
      active: form.get("active") === "on",
    })
    .eq("id", String(form.get("id")))
  if (error) return fail(error.message)
  revalidatePath("/admin/clients", "layout")
  revalidatePath("/clients", "layout")
  return { ok: true, message: "Saved. Conversion field changes apply from the next sync or backfill." }
}

/** Month budgets: fields named budget|<platform>|<YYYY-MM-01>. Blank fields are left as they are. */
export async function saveBudgets(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  const clientId = String(form.get("client_id"))
  const rows: { client_id: string; platform: string; campaign_id: string; month: string; amount: number }[] = []
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("budget|") || value === "") continue
    const [, platform, month] = key.split("|")
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0) return fail(`Budget for ${platform} ${month} must be a number.`)
    rows.push({ client_id: clientId, platform, campaign_id: "", month, amount })
  }
  if (!rows.length) return fail("Nothing to save.")
  const supabase = await createClient()
  const { error } = await supabase.from("client_budgets").upsert(rows, { onConflict: "client_id,platform,campaign_id,month" })
  if (error) return fail(error.message)
  revalidatePath("/admin/clients", "layout")
  revalidatePath("/clients", "layout")
  return { ok: true, message: "Budgets saved." }
}

/** One backfill chunk (one account, one date window) so each request stays under Vercel's time limit. */
export async function backfillChunk(accountId: string, dateFrom: string, dateTo: string) {
  await requireAdmin()
  const [result] = await syncWindsor({ accountId, dateFrom, dateTo, kind: "backfill" })
  revalidatePath("/clients", "layout")
  return result ? { ok: !result.error, rows: result.rows, error: result.error } : { ok: false, rows: 0, error: "Account not found or inactive" }
}

/** Ad previews for one account and date window (kept short: LinkedIn previews are slow in Windsor). */
export async function creativesChunk(accountId: string, dateFrom: string, dateTo: string) {
  await requireAdmin()
  const [r] = await syncCreatives({ accountId, dateFrom, dateTo, maxCopies: 60 })
  return r ? { ok: !r.error, ads: r.ads, copied: r.copied, error: r.error } : { ok: false, ads: 0, copied: 0, error: "Account not found or inactive" }
}

// ── People ─────────────────────────────────────────────────────────────────
const Role = z.enum(["admin", "gtm_lead", "am", "specialist"])

export async function saveInvite(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdmin()
  const email = String(form.get("email") ?? "").trim().toLowerCase()
  if (!z.string().email().safeParse(email).success || !email.endsWith(`@${domain}`)) return fail(`Use an @${domain} email.`)
  const role = Role.safeParse(form.get("role"))
  if (!role.success) return fail("Pick a role.")
  const full_name = String(form.get("full_name") ?? "").trim() || null
  const notion_user_id = String(form.get("notion_user_id") ?? "") || null
  const supabase = await createClient()
  const { error } = await supabase.from("team_invites").upsert({ email, full_name, role: role.data, notion_user_id }, { onConflict: "email" })
  if (error) return fail(error.message)
  // If they've already signed in, bring their profile in line (role only if they have none yet).
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("email", email).maybeSingle()
  if (profile) await supabase.from("profiles").update({ full_name, notion_user_id, ...(profile.role ? {} : { role: role.data }) }).eq("id", profile.id)
  revalidatePath("/admin/people")
  return { ok: true, message: profile ? "Saved and applied to their account." : "Saved. It applies when they first sign in." }
}

export async function setProfileRole(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireAdmin()
  const id = String(form.get("id"))
  const raw = String(form.get("role") ?? "")
  const role = raw === "" ? null : Role.safeParse(raw).success ? raw : undefined
  if (role === undefined) return fail("Unknown role.")
  if (id === me.id && role !== "admin" && role !== "gtm_lead") return fail("You can't remove your own admin access.")
  const supabase = await createClient()
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id)
  if (error) return fail(error.message)
  revalidatePath("/admin/people")
  return { ok: true, message: "Role updated." }
}
