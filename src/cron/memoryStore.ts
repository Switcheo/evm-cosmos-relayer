// just a temporary in memory store
const memoryStore = new Map<string, number>()

export function checkOrSetSnooze(key: string, ttlSeconds: number): boolean {
  const now = Date.now()
  const expiry = memoryStore.get(key)
  if (expiry && expiry > now) return true

  memoryStore.set(key, now + ttlSeconds * 1000)
  return false
}

const retryCountStore = new Map<string, number>()

export function incrementAndGetRetryCount(key: string): number {
  const count = (retryCountStore.get(key) ?? 0) + 1
  retryCountStore.set(key, count)
  return count
}

export function getRetryCount(key: string): number {
  return retryCountStore.get(key) ?? 0
}
