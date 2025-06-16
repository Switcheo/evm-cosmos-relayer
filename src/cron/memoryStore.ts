// just a temporary in memory store
const memoryStore = new Map<string, number>()

export function checkOrSetSnooze(key: string, ttlSeconds: number): boolean {
  const now = Date.now()
  const expiry = memoryStore.get(key)
  if (expiry && expiry > now) return true

  memoryStore.set(key, now + ttlSeconds * 1000)
  return false
}
