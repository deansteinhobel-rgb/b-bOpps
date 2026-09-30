import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { claude } from "@/lib/ai/claude"
import { longDate, money, oneDp, withSymbols } from "@/lib/format"
import { briefForPrompt } from "@/lib/knowledge/brief"
import { PLATFORM_LABEL } from "@/lib/metrics/types"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SprintTest } from "./data"
import { improvement, metricValue, resultsOf, TEST_KINDS, VERDICTS, type TestDetail, type Totals, type VerdictKind } from "./results"
import { ASSETS, METRICS, successLine } from "./tests"

/**
 * Claude's read on a live test (Dean, 2026-09-30): once a day per test, stored in test_reads. No web
 * tools: it reads the test (what's being tested and why), the numbers from loadTestDetail and the
 * client brief, and says whether it's working, why, and what to do next.
 */
export const TEST_READ_MODEL = "claude-opus-5-5"

export type TestRead = {
  verdict: VerdictKind
  confidence: "low" | "medium" | "high" | null
  headline: string
  points: string[]
  next_step: string | null
  next_step_kind: "keep_running" | "scale" | "fix" | "call_it" | null
  created_at: string
}

const SUBMIT = {
  name: "submit_read",
  description: "Submit your read on this test. Call it exactly once, at the end.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["too_early", "working", "not_yet", "hurting"], description: "Your verdict. Usually the app's verdict; disagree only with a clear reason from the numbers, and say it in the points." },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      headline: { type: "string", description: "One sentence a non-specialist understands: is the test doing its job? Numbers with currency symbols." },
      points: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" }, description: "2-5 short points (under 30 words each): what's driving the result, how the test ads compare with the rest, what the account did around it, anything that muddies the read." },
      next_step_kind: { type: "string", enum: ["keep_running", "scale", "fix", "call_it"] },
      next_step: { type: "string", description: "One concrete next step for the paid media team, under 30 words." },
    },
    required: ["verdict", "confidence", "headline", "points", "next_step_kind", "next_step"],
  },
}

function totalsLine(t: Totals, m: (v: number) => string) {
  const r = resultsOf(t)
  const ctr = t.impressions ? ((t.clicks / t.impressions) * 100).toFixed(2) : "–"
  return `spend ${m(t.spend)}, ${t.impressions} impressions, ${t.clicks} clicks (CTR ${ctr}%), ${oneDp(t.conversions)} conversions + ${oneDp(t.leads)} leads = ${oneDp(r)} results, cost per result ${r ? m(t.spend / r) : "–"}`
}

/** The test and its numbers as text for the prompt. */
export function testReadContext(test: SprintTest, d: TestDetail, currency: string) {
  const m = (v: number) => money(v, currency)
  const def = METRICS[d.metric]
  const fmt = (v: number | null) => (v === null ? "–" : def.unit === "money" ? m(v) : def.unit === "percent" ? `${v.toFixed(2)}%` : oneDp(v))
  const lines = [
    `# The test`,
    `Title: ${test.title}`,
    `Platform: ${test.platform ? PLATFORM_LABEL[test.platform] : "Several platforms"}`,
    `Kind: ${TEST_KINDS[d.kind].label} (${TEST_KINDS[d.kind].hint})${d.kindGuessed ? " (worked out by the app from when the campaigns started spending)" : ""}`,
    test.hypothesis ? `Hypothesis: ${test.hypothesis}` : null,
    test.assets.length ? `Assets: ${test.assets.map((a) => ASSETS[a] ?? a).join(", ")}` : null,
    test.brief_notes ? `Brief notes: ${test.brief_notes}` : null,
    `Success looks like: ${successLine(test.success_metric, test.success_target, test.success_text, m)}`,
    `Campaigns: ${test.campaign_names.join("; ") || test.campaign_ids.join(", ")}`,
    `Live since ${longDate(d.live.from)}; data to ${longDate(d.live.to)} (${d.live.days} days). "Before" = ${longDate(d.before.from)} to ${longDate(d.before.to)}.`,
    ``,
    `# The app's verdict: ${VERDICTS[d.verdict.kind].label}. ${d.verdict.reason}`,
    `Judged on ${def.label}${d.target !== null ? `, target ${fmt(d.target)}` : ""}. A verdict needs 7+ days and at least one target cost per result of spend.`,
    ``,
    `# Comparisons (${def.label}: now vs then)`,
    ...d.comparisons.map((c) => {
      const now = metricValue(d.metric, c.now)
      const then = c.then ? metricValue(d.metric, c.then) : null
      const imp = improvement(d.metric, now, then)
      return `- ${c.label} vs ${c.against}: ${fmt(now)} vs ${fmt(then)}${imp === null ? "" : ` (${imp >= 0 ? "better" : "worse"} by ${Math.abs(Math.round(imp * 100))}%)`}\n  now: ${totalsLine(c.now, m)}${c.then ? `\n  then: ${totalsLine(c.then, m)}` : ""}`
    }),
    ``,
    `# Test ads${d.adsPicked ? " (picked by the team)" : d.kind === "change" ? " (ads first seen on or after the live date)" : ""}`,
    ...(d.testAds.length ? d.testAds.slice(0, 25).map((a) => `- ${a.name} (first seen ${a.first_seen ?? "?"}): ${totalsLine(a.totals, m)}`) : ["- none found in these campaigns"]),
    ...(d.otherAds.length ? [``, `# The campaign's other ads, same days`, ...d.otherAds.slice(0, 15).map((a) => `- ${a.name} (first seen ${a.first_seen ?? "?"}): ${totalsLine(a.totals, m)}`)] : []),
    ``,
    `# Test campaigns a day (date: spend, results)`,
    d.daily.map((x) => `${x.date.slice(5)}: ${m(x.spend)}, ${oneDp(x.results)}`).join(" | "),
  ]
  return lines.filter((l): l is string => l !== null).join("\n")
}

const system = (today: string) => `You are a senior B2B paid media strategist at Bordeaux & Burgundy, a content-first agency. Today is ${today}. You're reading one live test from the team's two-week sprint and saying, in plain words, whether it's doing its job.

How to judge:
- Judge what was changed. For a change to an established campaign, the test ads against the campaign's other ads over the same days matter most, then the campaign against itself before the test. For a new campaign, the campaign against the target and the platform's other campaigns.
- The account figures are context: if the whole account moved the same way, the test probably didn't cause it. Say so.
- Small numbers are noisy. A handful of results can swing cost per result a lot; say how sure you are. Platforms' learning phases (roughly the first week) usually cost more.
- Read the hypothesis and success measure: a test can miss the headline metric and still prove or disprove what it set out to learn.
- Currency is always a symbol ($, £, €). Use the client's brief for context on goals and audience. Never invent numbers that aren't given.`

/** Writes today's read for a test (the caller has checked access). Uses the admin client. */
export async function writeTestRead(db: SupabaseClient, o: { test: SprintTest; clientId: string; currency: string; detail: TestDetail; today: string; requestedBy: string | null }): Promise<TestRead> {
  const brief = await briefForPrompt(o.clientId)
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${brief ? `${brief}\n\n` : ""}${testReadContext(o.test, o.detail, o.currency)}\n\nRead this test, then call submit_read.` }]
  const usage = { input_tokens: 0, output_tokens: 0 }
  let submitted: Record<string, unknown> | null = null
  for (let turn = 0; turn < 3 && !submitted; turn++) {
    const msg = await claude()
      .messages.stream({ model: TEST_READ_MODEL, max_tokens: 16000, thinking: { type: "adaptive" }, system: system(o.today), tools: [SUBMIT] as unknown as Anthropic.Messages.ToolUnion[], tool_choice: { type: "auto" }, messages })
      .finalMessage()
    usage.input_tokens += msg.usage.input_tokens
    usage.output_tokens += msg.usage.output_tokens
    const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT.name)
    if (call) submitted = call.input as Record<string, unknown>
    else messages.push({ role: "assistant", content: msg.content }, { role: "user", content: "Please call submit_read now." })
  }
  if (!submitted) throw new Error("Claude didn't submit a read.")
  const clip = (s: unknown, n: number) => withSymbols(String(s ?? "")).slice(0, n)
  const pick = <T extends string>(v: unknown, ok: readonly T[]): T | null => (ok.includes(v as T) ? (v as T) : null)
  const row = {
    client_id: o.clientId,
    sprint_test_id: o.test.id,
    read_on: o.today,
    verdict: pick(submitted.verdict, ["too_early", "working", "not_yet", "hurting"] as const) ?? o.detail.verdict.kind,
    confidence: pick(submitted.confidence, ["low", "medium", "high"] as const),
    headline: clip(submitted.headline, 400),
    points: (Array.isArray(submitted.points) ? submitted.points : []).slice(0, 5).map((p) => clip(p, 240)),
    next_step: clip(submitted.next_step, 240) || null,
    next_step_kind: pick(submitted.next_step_kind, ["keep_running", "scale", "fix", "call_it"] as const),
    model: TEST_READ_MODEL,
    usage,
    requested_by_profile_id: o.requestedBy,
    created_at: new Date().toISOString(),
  }
  const { error } = await db.from("test_reads").upsert(row, { onConflict: "sprint_test_id,read_on" })
  if (error) throw new Error(`Saving the read: ${error.message}`)
  return { verdict: row.verdict, confidence: row.confidence, headline: row.headline, points: row.points, next_step: row.next_step, next_step_kind: row.next_step_kind, created_at: row.created_at }
}
