/** Feature ideas and bug reports (Options → Admin → Feedback): status labels and colors. */
export const FEEDBACK_STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "border-foreground/20 text-muted-foreground" },
  planned: { label: "Planned", cls: "border-violet/40 bg-violet/10 text-violet" },
  in_progress: { label: "In progress", cls: "border-rag-amber/40 bg-rag-amber/10 text-rag-amber" },
  done: { label: "Done", cls: "border-rag-green/40 bg-rag-green/10 text-rag-green" },
  wont_do: { label: "Not planned", cls: "border-foreground/15 text-muted-foreground" },
}
