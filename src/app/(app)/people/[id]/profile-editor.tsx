"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Avatar } from "@/components/brand"
import { fieldClass } from "@/components/field-class"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { removeAvatar, updateProfile, uploadAvatar } from "../actions"

type Details = { full_name: string; job_title: string; phone: string; location: string; timezone: string; bio: string }

/** Shrinks a picture to a 256px square WebP in the browser (center crop), so uploads stay small. */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 256
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
  return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the image."))), "image/webp", 0.88))
}

/** Edit a profile: picture, name, job title, contact details, time zone and a short bio. */
export function ProfileEditor({ profileId, own, name, avatarUrl, defaults }: { profileId: string; own: boolean; name: string; avatarUrl: string | null; defaults: Details }) {
  const [d, setD] = useState<Details>(defaults)
  const [pending, start] = useTransition()
  const [uploading, setUploading] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), [])
  const dirty = JSON.stringify(d) !== JSON.stringify(defaults)
  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value })

  const pick = async (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    try {
      const blob = await toSquareWebp(f)
      const form = new FormData()
      form.set("file", new File([blob], "avatar.webp", { type: "image/webp" }))
      const r = await uploadAvatar(profileId, form)
      if (r.ok) toast.success("Picture updated.")
      else toast.error(r.message ?? "Couldn't upload.")
    } catch {
      toast.error("Couldn't read that image. Try a JPG or PNG.")
    }
    setUploading(false)
    if (file.current) file.current.value = ""
  }

  return (
    <section className="surface space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={d.full_name || name} url={avatarUrl} className="size-16 text-lg" />
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{own ? "Your picture" : "Profile picture"}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => file.current?.click()}>
              {uploading ? "Uploading…" : avatarUrl ? "Change" : "Upload a picture"}
            </Button>
            {avatarUrl && (
              <Button size="sm" variant="ghost" disabled={uploading || pending} onClick={() => start(async () => void (await removeAvatar(profileId)))}>
                Remove
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Square works best. It&apos;s cropped to a circle.</p>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={d.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Job title">
          <Input value={d.job_title} onChange={set("job_title")} placeholder="e.g. Paid Media Specialist" />
        </Field>
        <Field label="Phone">
          <Input value={d.phone} onChange={set("phone")} placeholder="Optional" />
        </Field>
        <Field label="Location">
          <Input value={d.location} onChange={set("location")} placeholder="e.g. London" />
        </Field>
        <Field label="Time zone" className="sm:col-span-2">
          <select className={fieldClass} value={d.timezone} onChange={set("timezone")}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="About" className="sm:col-span-2">
          <Textarea rows={4} value={d.bio} onChange={set("bio")} placeholder="What you work on, and anything the team should know (working hours, specialties)." />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const r = await updateProfile(profileId, d)
              if (r.ok) toast.success("Profile saved.")
              else toast.error(r.message ?? "Couldn't save.")
            })
          }
        >
          {pending ? "Saving…" : "Save profile"}
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setD(defaults)}>
            Undo changes
          </Button>
        )}
      </div>
    </section>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
