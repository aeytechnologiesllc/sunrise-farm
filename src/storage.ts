const localMemory = new Map<string, string>()
const sessionMemory = new Map<string, string>()
const storageCache: Partial<Record<'local' | 'session', Storage | false>> = {}

function storage(kind: 'local' | 'session'): Storage | null {
  const cached = storageCache[kind]
  if (cached !== undefined) return cached || null
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage
    const key = '__sunrise_storage_probe__'
    s.setItem(key, '1')
    s.removeItem(key)
    storageCache[kind] = s
    return s
  } catch {
    storageCache[kind] = false
    return null
  }
}

function safe(kind: 'local' | 'session', memory: Map<string, string>) {
  return {
    getItem(key: string): string | null {
      const s = storage(kind)
      if (s) {
        try {
          return s.getItem(key)
        } catch {
          return memory.get(key) ?? null
        }
      }
      return memory.get(key) ?? null
    },

    setItem(key: string, value: string): void {
      const s = storage(kind)
      if (s) {
        try {
          s.setItem(key, value)
          return
        } catch {
          // fall through to memory
        }
      }
      memory.set(key, value)
    },

    removeItem(key: string): void {
      const s = storage(kind)
      if (s) {
        try {
          s.removeItem(key)
        } catch {
          // fall through to memory
        }
      }
      memory.delete(key)
    },

    available(): boolean {
      return storage(kind) !== null
    },
  }
}

export const safeStorage = safe('local', localMemory)
export const safeSessionStorage = safe('session', sessionMemory)
