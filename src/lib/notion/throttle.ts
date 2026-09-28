/**
 * A small queue that keeps Notion calls under ~3 requests per second (the documented average).
 * Calls run one at a time, at least MIN_GAP_MS apart. The SDK also retries 429s itself.
 */
const MIN_GAP_MS = 350
let tail: Promise<unknown> = Promise.resolve()
let last = 0

export function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    const wait = last + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return fn()
  })
  tail = run.catch(() => undefined)
  return run
}
