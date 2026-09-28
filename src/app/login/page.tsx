import { AppHeader } from "@/components/app-header"
import { Card, CardContent } from "@/components/ui/card"
import { LoginForm } from "./login-form"

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new one.",
  domain: "Only Bordeaux & Burgundy accounts can sign in.",
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
        <p className="eyebrow">Account Ops</p>
        <h1 className="mt-2 mb-6 text-4xl">Sign in</h1>
        <Card>
          <CardContent>
            <LoginForm next={typeof next === "string" ? next : undefined} error={typeof error === "string" ? ERRORS[error] : undefined} />
          </CardContent>
        </Card>
      </main>
    </>
  )
}
