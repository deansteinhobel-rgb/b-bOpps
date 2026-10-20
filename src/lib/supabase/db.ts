import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, Json } from "./database.types"

/** A Supabase client typed with our schema (`database.types.ts`, from `pnpm types:db`): the user's, or the admin one. */
export type Db = SupabaseClient<Database>

/**
 * JSON columns are `Json` in the generated types. These are the one place the app crosses that
 * boundary: `toJson` for a typed value going in, `fromJson` for a column whose shape the app wrote.
 */
export const toJson = (value: unknown) => value as Json
export const fromJson = <T>(value: Json | null | undefined, fallback: T): T => (value ?? fallback) as T
