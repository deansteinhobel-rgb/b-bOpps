import { notFound } from "next/navigation"
import { getAccountNumbers, latestDataDay } from "@/lib/account"
import { canEdit, getProfile } from "@/lib/auth"
import { londonToday } from "@/lib/checks/periods"
import { money, whole } from "@/lib/format"
import { cachedPacing } from "@/lib/metrics/cached"
import { sprintOf } from "@/lib/sprints/periods"
import { createClient } from "@/lib/supabase/server"
import { GlanceBoard } from "./_glance/glance-board"
import { GlanceCards } from "./_glance/glance-cards"
import { loadGoals, monthName, spendOf } from "./_glance/glance-data"
import { SpendBreakdown } from "./_glance/spend-breakdown"
import { cprTone, paceWords } from "./_glance/tones"
import { loadTargets } from "@/lib/targets"

export const metadata = { title: "Summary" }

/**
 * At a glance, the client's overview (Dean, 2026-09-29; cards since 2026-09-30): how the account is doing,
 * for anyone, with or without a paid media background. The month in one line, a row of tiles, then cards
 * for where the money went, ads, what's changed and what's planned; each opens its full section.
 */
export default async function AtAGlancePage({ params }: PageProps<"/clients/[slug]">) {
  const { slug } = await params
  const supabase = await createClient()
  const [{ data: client }, me] = await Promise.all([supabase.from("clients").select("id, slug, name, currency, monthly_kpi_target").eq("slug", slug).maybeSingle(), getProfile()])
  if (!client) notFound()
  const cur = client.currency
  const target = client.monthly_kpi_target === null ? null : Number(client.monthly_kpi_target)
  const targetsP = loadTargets(supabase, client.id, client.monthly_kpi_target)
  const today = londonToday()
  const period = sprintOf(today)
  const throughP = latestDataDay(supabase, client.id)

  // Pages load in pieces (Dean, 2026-10-15): only the month line, the tiles and the spend card wait;
  // the Ads, What's changed and What's planned cards stream in with a spinner while they load.
  const [numbers, pacing, goals, targets] = await Promise.all([
    getAccountNumbers(supabase, client.id, throughP),
    cachedPacing(client.id), // access confirmed above (client loaded through RLS)
    loadGoals(supabase, client.id, today),
    targetsP,
  ])
  const { budget, expected, platforms } = spendOf(numbers, pacing)
  return (
    <GlanceBoard
      slug={slug}
      name={client.name}
      currency={cur}
      target={target}
      targets={targets}
      numbers={numbers}
      month={numbers ? monthName(numbers.month) : null}
      budget={budget}
      expected={expected}
      goals={goals}
      canEditGoals={canEdit(me)}
      platforms={platforms}
      headline={numbers ? <Headline name={client.name} currency={cur} target={target} budget={budget} expected={expected} month={monthName(numbers.month)} spend={numbers.mtd.spend} results={numbers.mtd.results} cpr={numbers.mtd.cpr} /> : null}
      spendDetail={numbers && platforms.length > 0 ? <SpendBreakdown slug={slug} currency={cur} targets={targets} platforms={platforms} campaigns={numbers.campaigns} total={numbers.mtd.spend} /> : null}
      cards={<GlanceCards supabase={supabase} slug={slug} client={client} today={today} period={period} through={throughP} />}
    />
  )
}

/** The month in one plain sentence: spend against budget and pace, then results against target. */
function Headline({ name, currency, target, budget, expected, month, spend, results, cpr }: { name: string; currency: string; target: number | null; budget: number; expected: number; month: string; spend: number; results: number; cpr: number | null }) {
  const pace = budget > 0 ? paceWords(spend, expected, budget) : null
  const paceBad = pace && pace !== "on pace" && (spend > budget || Math.abs(spend / expected - 1) > 0.2)
  return (
    <p className="max-w-5xl font-heading text-lg leading-snug sm:text-xl">
      {name} has spent {money(spend, currency)}
      {budget > 0 ? ` of its ${money(budget, currency)} ${month} budget` : ` in ${month}`}
      {pace && (
        <>
          {pace === "on pace" ? ", " : " and is "}
          <span className={pace === "on pace" ? "text-rag-green" : paceBad ? "text-rag-red" : "text-rag-amber"}>{pace === "on pace" ? "right on pace" : pace}</span>
        </>
      )}
      .{" "}
      {results > 0 && cpr !== null ? (
        <>
          That&apos;s {whole(results)} result{Math.round(results) === 1 ? "" : "s"} at <span className={cprTone(cpr, target)}>{money(cpr, currency)} each</span>
          {target ? (cpr <= target ? `, under the ${money(target, currency)} target.` : `, ${Math.round((cpr / target - 1) * 100)}% over the ${money(target, currency)} target.`) : "."}
        </>
      ) : spend > 0 ? (
        <span className="text-rag-amber">No results yet this month.</span>
      ) : null}
    </p>
  )
}
