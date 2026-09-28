import { AppHeader } from "@/components/app-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Placeholder until /login and /clients exist. Shows the theme so it can be checked.
export default function Home() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
        <p className="eyebrow">Phase 1</p>
        <h1 className="mt-2 text-4xl">
          One place per client. <span className="bg-lime px-1">Built on your data.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Paid media performance, weekly QA checks and Notion actions for every client.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Green", "bg-rag-green-bg text-rag-green"],
              ["Amber", "bg-rag-amber-bg text-rag-amber"],
              ["Red", "bg-rag-red-bg text-rag-red"],
              ["N/A", "bg-rag-na-bg text-rag-na"],
            ] as const
          ).map(([label, cls]) => (
            <Card key={label}>
              <CardHeader>
                <CardTitle className="font-heading text-xl font-normal">Status colours</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge className={cls}>{label}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-8 flex gap-3">
          <Button>Primary action</Button>
          <Button variant="outline">Secondary</Button>
        </div>
      </main>
    </>
  )
}
