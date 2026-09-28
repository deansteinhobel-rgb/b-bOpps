/**
 * A Notion client that can only read. Any write method (create, update, append, delete, move,
 * comment, upload) throws before a request is sent. Scripts must use this, never `new Client()`.
 */
import { Client } from "@notionhq/client"

const WRITE_METHOD = /^(create|update|append|delete|move|send|complete|upload|trash|archive|restore)/i

function guard<T extends object>(target: T, path: string): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      const value = Reflect.get(obj, key, receiver)
      const name = `${path}.${String(key)}`
      if (typeof value === "function") {
        if (WRITE_METHOD.test(String(key)) || key === "request") {
          return () => {
            throw new Error(`Blocked: ${name} would write to Notion. This client is read-only.`)
          }
        }
        return value.bind(obj)
      }
      if (value && typeof value === "object") return guard(value, name)
      return value
    },
  })
}

export function readOnlyNotion(auth: string, notionVersion: string): Client {
  return guard(new Client({ auth, notionVersion }), "notion")
}
