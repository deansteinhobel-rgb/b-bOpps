import { redirect } from "next/navigation"

// Actions now live inside the Sprint tab (Dean, 2026-09-28).
export default async function ActionsPage({ params }: PageProps<"/clients/[slug]/actions">) {
  const { slug } = await params
  redirect(`/clients/${slug}/sprint`)
}
