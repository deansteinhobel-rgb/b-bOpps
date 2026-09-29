"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { fieldClass } from "@/components/field-class"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { savePreferences, sendFeedback } from "./actions"

type Prefs = { default_days: 7 | 14 | 30 | 90 | number; optimise_order: "claude" | "priority"; start_page: string; animations: boolean }

/** Preferences that change how the app behaves for you. */
export function PreferencesForm({ clients, defaults }: { clients: { slug: string; name: string }[]; defaults: Prefs }) {
  const [p, setP] = useState(defaults)
  const [pending, start] = useTransition()
  const dirty = JSON.stringify(p) !== JSON.stringify(defaults)
  return (
    <section className="surface max-w-3xl divide-y">
      <Pref title="Open the app on" hint="Where you land after signing in.">
        <select className={`${fieldClass} w-64`} value={p.start_page} onChange={(e) => setP({ ...p, start_page: e.target.value })}>
          <option value="clients">All clients</option>
          {clients.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </Pref>
      <Pref title="Performance period" hint="The period the Performance tab opens on.">
        <Segmented
          label="Default period"
          value={String(p.default_days) as "7" | "14" | "30" | "90"}
          onChange={(v) => setP({ ...p, default_days: Number(v) })}
          options={(["7", "14", "30", "90"] as const).map((d) => ({ value: d, label: `${d} days` }))}
        />
      </Pref>
      <Pref title="Optimise now order" hint="Claude's ranking from the daily review, or severity and money at stake.">
        <Segmented
          label="Optimise now order"
          tone="quiet"
          value={p.optimise_order}
          onChange={(v) => setP({ ...p, optimise_order: v })}
          options={[
            { value: "claude", label: "Claude's order" },
            { value: "priority", label: "Priority" },
          ]}
        />
      </Pref>
      <Pref title="Animations" hint="The starfield, pours, sliding highlights and other motion. Off also helps on slower laptops.">
        <Segmented
          label="Animations"
          tone="quiet"
          value={p.animations ? "on" : "off"}
          onChange={(v) => setP({ ...p, animations: v === "on" })}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Pref>
      <div className="flex items-center gap-2 px-5 py-4">
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const r = await savePreferences({ ...p, default_days: p.default_days as 7 | 14 | 30 | 90 })
              if (r.ok) toast.success("Preferences saved.")
              else toast.error(r.message ?? "Couldn't save.")
            })
          }
        >
          {pending ? "Saving…" : "Save preferences"}
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setP(defaults)}>
            Undo
          </Button>
        )}
      </div>
    </section>
  )
}

function Pref({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

/** Suggest a feature or report a bug. */
export function FeedbackForm({ kind }: { kind: "feature" | "bug" }) {
  const blank = { title: "", details: "", page_url: "", happened: "", expected: "" }
  const [f, setF] = useState(blank)
  const [pending, start] = useTransition()
  const bug = kind === "bug"
  const submit = () =>
    start(async () => {
      const details = bug ? [f.happened && `What happened:\n${f.happened}`, f.expected && `What I expected:\n${f.expected}`, f.details && `Anything else:\n${f.details}`].filter(Boolean).join("\n\n") : f.details
      const r = await sendFeedback({ kind, title: f.title, details, page_url: f.page_url })
      if (!r.ok) return void toast.error(r.message ?? "Couldn't send it.")
      toast.success(bug ? "Thanks, bug reported." : "Thanks, idea sent.")
      setF(blank)
    })
  return (
    <section className="surface space-y-4 p-6">
      <div>
        <h2 className="text-xl">{bug ? "Report a bug" : "Suggest a feature"}</h2>
        <p className="text-sm text-muted-foreground">{bug ? "Something broken or not behaving? Tell us where and what happened." : "An idea that would save you time, or something you wish the app did."}</p>
      </div>
      <Field label={bug ? "What's wrong, in a line" : "The idea, in a line"}>
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={bug ? "e.g. Sprint board doesn't load for Camber" : "e.g. Weekly email with each client's top 3 insights"} />
      </Field>
      {bug ? (
        <>
          <Field label="Where (page or link)">
            <Input value={f.page_url} onChange={(e) => setF({ ...f, page_url: e.target.value })} placeholder="e.g. /clients/camber/sprint" />
          </Field>
          <Field label="What happened">
            <Textarea rows={3} value={f.happened} onChange={(e) => setF({ ...f, happened: e.target.value })} />
          </Field>
          <Field label="What you expected">
            <Textarea rows={2} value={f.expected} onChange={(e) => setF({ ...f, expected: e.target.value })} />
          </Field>
          <Field label="Anything else (optional)">
            <Textarea rows={2} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
          </Field>
        </>
      ) : (
        <Field label="Why it would help (optional)">
          <Textarea rows={5} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Who it's for, what you'd do with it, how you do it today." />
        </Field>
      )}
      <Button size="sm" disabled={pending || f.title.trim().length < 3} onClick={submit}>
        {pending ? "Sending…" : bug ? "Report the bug" : "Send the idea"}
      </Button>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
