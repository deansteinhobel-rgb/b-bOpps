import { describe, expect, it } from "vitest"
import { suggestChanges, type AdEvent, type DailySpend } from "./detect"

const ev = (o: Partial<AdEvent>): AdEvent => ({
  platform: "linkedin", ad_id: "a", ad_name: "Ad", campaign_name: "SMB", first_seen: "2026-06-30", last_seen: "2026-10-10",
  data_through: "2026-10-10", spend_in_range: 100, ...o,
})
const days = (platform: DailySpend["platform"], from: string, n: number, spend: number): DailySpend[] =>
  Array.from({ length: n }, (_, i) => ({ platform, date: new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10), spend }))

const base = { from: "2026-09-28", to: "2026-10-11", currency: "USD", daily: [] as DailySpend[] }

describe("suggestChanges", () => {
  it("groups new ads by campaign and day", () => {
    const s = suggestChanges({ ...base, events: [ev({ ad_id: "1", first_seen: "2026-09-30" }), ev({ ad_id: "2", first_seen: "2026-09-30" }), ev({ ad_id: "3", first_seen: "2026-06-30" })] })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ type: "creative", changed_on: "2026-09-30", key: "new|linkedin|SMB|2026-09-30" })
    expect(s[0].description).toContain("2 new LinkedIn ads launched in “SMB”")
  })

  it("flags ads that stopped running (and spent), dated the day after their last impressions", () => {
    const s = suggestChanges({ ...base, events: [ev({ last_seen: "2026-10-02" }), ev({ ad_id: "free", last_seen: "2026-10-02", spend_in_range: 0 }), ev({ ad_id: "live", last_seen: "2026-10-10" })] })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ changed_on: "2026-10-03", key: "stop|linkedin|SMB|2026-10-02" })
  })

  it("flags week-on-week spend shifts of 30%+ for complete weeks only", () => {
    const daily = [...days("meta", "2026-09-21", 7, 100), ...days("meta", "2026-09-28", 7, 150), ...days("google_ads", "2026-09-21", 14, 200), ...days("meta", "2026-10-05", 3, 999)]
    const s = suggestChanges({ ...base, events: [], daily })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ type: "budget", platform: "meta", key: "spend|meta|2026-09-28" })
    expect(s[0].description).toBe("Meta spend up 50% week on week ($700 → $1,050)")
  })
})
