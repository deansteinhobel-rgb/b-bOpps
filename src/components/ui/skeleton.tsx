import { cn } from "cn"

// Static placeholder: no pulsing (taste sweep 2026-10-21); pages pair it with a Spinner.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
