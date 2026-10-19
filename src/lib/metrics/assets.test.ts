import { describe, expect, it } from "vitest"
import { assetGroups, mergeAssets, pickAssets, type AssetTotalsRow } from "./assets"
import { derive } from "./performance"

const row = (id: string, field: string, spend: number, clicks: number, conversions: number, extra: Record<string, unknown> = {}, group = "Group A"): AssetTotalsRow => ({
  groupId: group,
  groupName: group,
  dim1: id,
  dim2: field,
  extra: { asset_type: field === "HEADLINE" ? "TEXT" : "IMAGE", ...extra },
  m: derive({ spend, impressions: clicks * 20, clicks, conversions, leads: 0 }),
})

describe("mergeAssets", () => {
  it("adds up one asset across asset groups and keeps the weakest ad strength out", () => {
    const [a] = mergeAssets([row("1", "HEADLINE", 100, 10, 1, { asset_group_ad_strength: "AVERAGE" }), row("1", "HEADLINE", 50, 5, 2, { asset_group_ad_strength: "GOOD" }, "Group B")])
    expect(a.m.spend).toBe(150)
    expect(a.m.results).toBe(3)
    expect(a.groups).toEqual(["Group A", "Group B"])
    expect(a.adStrength).toBe("GOOD")
  })

  it("keeps Google's image host and YouTube ids only", () => {
    const [good, bad, video] = mergeAssets([
      row("1", "MARKETING_IMAGE", 30, 3, 0, { asset_image_asset_full_size_url: "https://tpc.googlesyndication.com/simgad/123" }),
      row("2", "MARKETING_IMAGE", 20, 2, 0, { asset_image_asset_full_size_url: "https://evil.example/x.png" }),
      { ...row("3", "YOUTUBE_VIDEO", 10, 1, 0, { asset_type: "YOUTUBE_VIDEO", asset_youtube_video_asset_youtube_video_id: "66EGIIZDoms" }) },
    ])
    expect(good.imageUrl).toBe("https://tpc.googlesyndication.com/simgad/123")
    expect(bad.imageUrl).toBeNull()
    expect(video.imageUrl).toBe("https://i.ytimg.com/vi/66EGIIZDoms/mqdefault.jpg")
    expect(video.videoUrl).toBe("https://www.youtube.com/watch?v=66EGIIZDoms")
  })

  it("orders the types images first, then video, then words", () => {
    const groups = assetGroups(mergeAssets([row("1", "DESCRIPTION", 1, 1, 0), row("2", "HEADLINE", 1, 1, 0), row("3", "SQUARE_MARKETING_IMAGE", 1, 1, 0), row("4", "YOUTUBE_VIDEO", 1, 1, 0)]))
    expect(groups.map((g) => g.field)).toEqual(["SQUARE_MARKETING_IMAGE", "YOUTUBE_VIDEO", "HEADLINE", "DESCRIPTION"])
  })
})

describe("pickAssets", () => {
  it("compares images (not logos) and headlines, each against its own type", () => {
    const assets = mergeAssets([
      row("h1", "HEADLINE", 900, 100, 9, { asset_text_asset_text: "Cheap" }),
      row("h2", "HEADLINE", 800, 80, 3, { asset_text_asset_text: "Dear" }),
      row("h3", "HEADLINE", 700, 70, 4, { asset_text_asset_text: "Middle" }),
      row("h4", "HEADLINE", 1, 1, 0, { asset_text_asset_text: "Barely ran" }),
      row("i1", "MARKETING_IMAGE", 50, 10, 0),
      row("i2", "SQUARE_MARKETING_IMAGE", 40, 2, 0),
      row("l1", "LOGO", 2000, 300, 12),
    ])
    const [images, headlines] = pickAssets(assets)
    expect(images.key).toBe("images")
    expect([...images.best, ...images.worst].map((p) => p.asset.id)).not.toContain("l1")
    expect(images.basis).toBe("ctr")
    expect(images.best[0].asset.id).toBe("i1")
    expect(headlines.basis).toBe("cost_per_result")
    expect(headlines.best[0].asset.text).toBe("Cheap")
    expect(headlines.best.map((p) => p.asset.id)).not.toContain("h4")
  })

  it("skips a type with fewer than 2 assets that spent", () => {
    expect(pickAssets(mergeAssets([row("h1", "HEADLINE", 10, 1, 0), row("i1", "MARKETING_IMAGE", 0, 0, 0)]))).toEqual([])
  })
})
