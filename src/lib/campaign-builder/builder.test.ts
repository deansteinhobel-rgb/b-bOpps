import { describe, expect, it } from "vitest"
import { checkLinkedIn, type BuildContext } from "@/lib/ads-api/spec"
import { linkedInSteps } from "@/lib/ads-api/plan"
import { campaignPatch, describeChange, runEdit, type EditStore } from "@/lib/ads-api/edit"
import { checkGuardrails, rulesFor, type PlaybookRule } from "./guardrails"
import { knownUrn, plan as planSchema, planToSpec, unresolved, UNRESOLVED, type Plan } from "./plan-schema"
import { isAbxCampaign } from "./presets"
import { cleanPlaybook } from "./playbook"

const ctx: BuildContext = { website: "https://www.camber.health", monthBudget: 20_000, spentThisMonth: 9_000, today: "2026-10-21", clientId: "11111111-1111-1111-1111-111111111111" }

const raw = {
  summary: "Document ads to the PE contact list.",
  group: { name: "ABM | PE Contact Target List" },
  campaign: { name: "ABM | PE Contact Target List | OIG audit | Single Image Ads | Website Visits", objective: "WEBSITE_VISIT", costType: "CPM", bid: 40, dailyBudget: 60, startDate: "2026-11-03", locale: { country: "US", language: "en" } },
  audience: {
    summary: "PE contacts, finance and operations.",
    include: {
      locations: [{ name: "United States", urn: "urn:li:geo:103644278" }],
      interfaceLocales: [{ name: "English", urn: "urn:li:locale:en_US" }],
      audienceMatchingSegments: [{ name: "PE Contact Target List", urn: null }],
    },
  },
  ads: [
    { name: "OIG audit 1", format: "single_image", commentary: "What the OIG found.", headline: "The ABA audit wave", landingUrl: "https://www.camber.health/oig", creativeBrief: "Chart", imagePath: "11111111-1111-1111-1111-111111111111/a.png" },
    { name: "CEO post", format: "thought_leader", commentary: "", headline: "", creativeBrief: "CEO's audit post", postUrn: "urn:li:share:7100000000000000000" },
    { name: "Video", format: "video", commentary: "x", headline: "y", creativeBrief: "30s" },
  ],
  rationale: [{ point: "PE list engaged best", source: "LinkedIn history" }],
  success: "CTR above 0.6%",
}

describe("plan → spec", () => {
  const plan = planSchema.parse(raw) as Plan
  it("marks values without a LinkedIn id", () => {
    expect(unresolved(plan)).toEqual([{ facet: "audienceMatchingSegments", side: "include", name: "PE Contact Target List" }])
  })
  it("builds image and sponsored-post ads, and leaves out formats the app can't build", () => {
    const { spec, leftOut } = planToSpec(plan, "123")
    expect(spec.ads).toHaveLength(2)
    expect(spec.campaign.targeting.include.audienceMatchingSegments[0]).toBe(`${UNRESOLVED}PE_Contact_Target_List`)
    expect(leftOut.join()).toMatch(/Video/)
    const r = checkLinkedIn(spec, ctx)
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toMatch(/no LinkedIn id yet/)
  })
  it("sponsors an existing post without uploading or posting", () => {
    const { spec } = planToSpec(plan, "123")
    const r = checkLinkedIn(spec, ctx)
    const steps = linkedInSteps(r.spec!, "500", "USD")
    expect(steps.map((s) => s.key)).toEqual(["group", "campaign", "image:0", "post:0", "ad:0", "ad:1"])
    expect(steps.at(-1)!.payload({ campaign: "9" })).toMatchObject({ content: { reference: "urn:li:share:7100000000000000000" }, intendedStatus: "PAUSED" })
    expect(steps[1].payload({ group: "1" })).not.toHaveProperty("format")
  })
  it("lead gen needs a lead form, and its ads open the form instead of a landing page", () => {
    const leadGen = { ...plan, campaign: { ...plan.campaign, objective: "LEAD_GENERATION" as const }, ads: [{ ...plan.ads[0], landingUrl: "" }] }
    expect(checkLinkedIn(planToSpec(leadGen, "123").spec, ctx).errors.join()).toMatch(/lead form/)
    const withForm = { ...leadGen, campaign: { ...leadGen.campaign, leadForm: { name: "AI report form", urn: "urn:li:adForm:42" } } }
    const r = checkLinkedIn(planToSpec(withForm, "123").spec, ctx)
    expect(r.errors).toEqual([])
    const steps = linkedInSteps(r.spec!, "500", "USD")
    const post = steps.find((s) => s.key === "post:0")!.payload({ "image:0": "urn:li:image:1" })
    expect(post).not.toHaveProperty("contentLandingPage")
    expect(steps.find((s) => s.key === "ad:0")!.payload({ campaign: "9", "post:0": "urn:li:share:1" })).toMatchObject({ leadgenCallToAction: { destination: "urn:li:adForm:42", label: "LEARN_MORE" } })
  })
  it("fills in fixed ids for company size and seniority", () => {
    expect(knownUrn("staffCountRanges", "51-200")).toBe("urn:li:staffCountRange:(51,200)")
    expect(knownUrn("staffCountRanges", "10,001+ employees")).toBe("urn:li:staffCountRange:(10001,2147483647)")
    expect(knownUrn("seniorities", "Director")).toBe("urn:li:seniority:6")
    expect(knownUrn("titles", "Director")).toBeNull()
  })
  it("refuses another client's image", () => {
    const { spec } = planToSpec({ ...plan, ads: [{ ...plan.ads[0], imagePath: "22222222-2222-2222-2222-222222222222/a.png" }] }, "123")
    expect(checkLinkedIn(spec, ctx).errors.join()).toMatch(/another client/)
  })
})

describe("guardrails", () => {
  const rule = (r: Partial<PlaybookRule>): PlaybookRule => ({ id: "r", platform: "linkedin", client_id: null, kind: "guardrail", modes: ["general", "abx"], title: "Rule", body: "", check_rule: null, ...r })
  const spec = checkLinkedIn(planToSpec(planSchema.parse(raw) as Plan, "123").spec, ctx).spec!
  it("checks budgets, Audience Network and facets", () => {
    expect(checkGuardrails(spec, [rule({ check_rule: { field: "dailyBudget", op: "max", value: 50 } })])).toHaveLength(1)
    expect(checkGuardrails(spec, [rule({ check_rule: { field: "dailyBudget", op: "max", value: 100 } })])).toHaveLength(0)
    expect(checkGuardrails({ ...spec, campaign: { ...spec.campaign, offsiteDelivery: true } }, [rule({ check_rule: { field: "audienceNetwork", op: "forbid" } })])).toHaveLength(1)
    expect(checkGuardrails(spec, [rule({ check_rule: { field: "facet", op: "require", value: "audienceMatchingSegments" } })])).toHaveLength(0)
    expect(checkGuardrails(spec, [rule({ kind: "practice", check_rule: { field: "dailyBudget", op: "max", value: 1 } })])).toHaveLength(0)
  })
  it("picks every-client rules, then the client's, for the view", () => {
    const rules = [rule({ id: "a", client_id: "c1" }), rule({ id: "b" }), rule({ id: "c", client_id: "c2" }), rule({ id: "d", modes: ["abx"] })]
    expect(rulesFor(rules, { platform: "linkedin", clientId: "c1", mode: "general" }).map((r) => r.id)).toEqual(["b", "a"])
    expect(rulesFor(rules, { platform: "linkedin", clientId: "c1", mode: "abx" }).map((r) => r.id)).toEqual(["b", "d", "a"])
  })
})

describe("ABX view", () => {
  it("reads account-based campaigns from their names", () => {
    expect(isAbxCampaign("ABM | PE Contact Target List | Document Ad")).toBe(true)
    expect(isAbxCampaign("dnsf_dg_2026-05_msp_linkedin-paid-social_free-trial_hot-msp-lists")).toBe(true)
    expect(isAbxCampaign("dnsf_dg_2026-09_msp_linkedin-paid-social_partner-program_hot-prospect-lists")).toBe(true)
    expect(isAbxCampaign("Fal.con_2026_Event_MatchedAudience_SingleImageAds_WC")).toBe(true)
    expect(isAbxCampaign("SMB Audience | Payer Rates Webinar | Single Image Ads | Lead Generation")).toBe(false)
    expect(isAbxCampaign("dnsf_dg_2026-09_remarketing_linkedin-paid-social_free-trial_general-site-visitors")).toBe(false)
  })
})

describe("campaign edits", () => {
  const before = { name: "Old", status: "ACTIVE", dailyBudget: 50, start: "2026-09-01", startMs: 1788220800000, end: null }
  it("only ever pauses, and keeps the start when the end date changes", () => {
    expect(campaignPatch({ kind: "pause" }, "USD", before)).toEqual({ patch: { $set: { status: "PAUSED" } } })
    expect(campaignPatch({ kind: "update", endDate: "2026-11-30" }, "USD", before)).toEqual({ patch: { $set: { runSchedule: { start: 1788220800000, end: Date.parse("2026-11-30T23:59:59Z") } } } })
    expect(() => campaignPatch({ kind: "update", dailyBudget: 5 }, "USD", before)).toThrow(/minimum/)
    expect(describeChange({ kind: "update", dailyBudget: 80 }, before, (n) => `$${n}`)).toEqual(["Daily budget: $50 → $80"])
  })
  it("logs first, and is a dry run without the edits switch", async () => {
    const logs: unknown[] = []
    const store: EditStore = { log: async (row) => (logs.push(row), { id: 1 }), finishLog: async () => {} }
    let sent = 0
    const sender = { patch: async () => void sent++ }
    const env = { writesEnabled: true, dryRun: false, platforms: ["linkedin"], liveClients: null }
    const o = { by: "p", client: { id: "c", slug: "camber" }, accountId: "500", campaignId: "9", currency: "USD", change: { kind: "pause" as const }, before, money: String }
    const dry = await runEdit({ store, sender, env }, o)
    expect(dry).toMatchObject({ ok: true, live: false })
    expect(sent).toBe(0)
    const live = await runEdit({ store, sender, env: { ...env, editsEnabled: true } }, o)
    expect(live).toMatchObject({ ok: true, live: true })
    expect(sent).toBe(1)
    expect(logs[0]).toMatchObject({ operation: "pause_campaign", previous: before, dry_run: true })
    expect(await runEdit({ store, sender, env }, { ...o, before: { ...before, status: "PAUSED" } })).toMatchObject({ ok: false })
  })
})

describe("playbook research", () => {
  it("keeps only real sources and the numbers that point at them", () => {
    const p = cleanPlaybook({
      summary: "s",
      sources: [{ n: 1, title: "LinkedIn", url: "https://business.linkedin.com/x", kind: "official" }, { n: 2, title: "bad", url: "javascript:alert(1)", kind: "other" }],
      sections: [{ heading: "Audiences", points: [{ text: "Keep audiences over 50k for cold", sources: [1, 2, 9], strength: "consensus" }, { text: "", sources: [] }] }, { heading: "Empty", points: [] }],
    })
    expect(p.sources.map((s) => s.n)).toEqual([1])
    expect(p.sections).toEqual([{ heading: "Audiences", points: [{ text: "Keep audiences over 50k for cold", sources: [1], strength: "consensus" }] }])
  })
})
