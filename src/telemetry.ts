import type { GameState } from './game/state'
import { safeStorage } from './storage'

export type SunriseTelemetryEvent =
  | 'boot'
  | 'ready'
  | 'first_move'
  | 'first_crop_planted'
  | 'first_harvest'
  | 'chicken_arrived'
  | 'chicken_named'
  | 'land_deed_bought'
  | 'project_built'
  | 'level_up'
  | 'performance_sample'
  | 'webgl_context_lost'
  | 'error'
  | 'unhandled_rejection'

export interface SunriseFarmSnapshot {
  coins: number
  wheat: number
  level: number
  xp: number
  harvests: number
  day: number
  fieldParcels: number
  projects: GameState['projects']
  chicken: {
    arrived: boolean
    named: boolean
    hearts: number
    eggsLaid: number
  }
  townDelivered: number
  playSeconds: number
}

export interface SunriseTelemetryMessage {
  source: 'sunrise-farm'
  type: 'event' | 'snapshot' | 'ready' | 'pong'
  event?: SunriseTelemetryEvent
  payload?: Record<string, unknown>
  snapshot?: SunriseFarmSnapshot
  sessionId: string
  sentAt: number
  ingestKey?: string
}

interface TelemetryOptions {
  saveKey: string
  build: string
  endpoint?: string
  snapshot: () => SunriseFarmSnapshot
  reset: () => void
}

interface AdminMessage {
  source?: string
  type?: string
  endpoint?: string
}

declare global {
  interface Window {
    sunriseFarm?: {
      track: (event: SunriseTelemetryEvent, payload?: Record<string, unknown>) => void
      snapshot: () => SunriseFarmSnapshot
      reset: () => void
      sessionId: string
    }
  }
}

function makeSessionId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function safePayload(payload: Record<string, unknown> = {}): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload, (_key, value) => {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.slice(0, 1600) }
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'function') return undefined
    return value
  })) as Record<string, unknown>
}

function endpointFromUrl(): string | undefined {
  const url = new URL(location.href)
  return url.searchParams.get('telemetry') || undefined
}

function ingestKeyFromUrl(): string | undefined {
  const url = new URL(location.href)
  return url.searchParams.get('telemetry_key') || url.searchParams.get('ingest_key') || undefined
}

function isAdminMessage(data: unknown): data is AdminMessage {
  if (!data || typeof data !== 'object') return false
  const d = data as AdminMessage
  return d.source === 'zulura-admin' && typeof d.type === 'string'
}

export function createTelemetry(options: TelemetryOptions): {
  track: (event: SunriseTelemetryEvent, payload?: Record<string, unknown>) => void
  milestone: (event: SunriseTelemetryEvent, payload?: Record<string, unknown>) => void
  configure: (endpoint?: string) => void
} {
  const sessionId = makeSessionId()
  const milestones = new Set<string>()
  let endpoint = endpointFromUrl() || options.endpoint || import.meta.env.VITE_SUNRISE_TELEMETRY_URL || ''
  const ingestKey = ingestKeyFromUrl() || import.meta.env.VITE_SUNRISE_TELEMETRY_KEY || ''

  const baseContext = (): Record<string, unknown> => ({
    build: options.build,
    sessionId,
    href: location.href,
    referrer: document.referrer || null,
    embedded: window.parent !== window,
    standalone: matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    userAgent: navigator.userAgent,
    savePresent: safeStorage.getItem(options.saveKey) !== null,
    storageAvailable: safeStorage.available(),
  })

  const postToParent = (message: SunriseTelemetryMessage): void => {
    if (window.parent === window) return
    window.parent.postMessage(message, '*')
  }

  const withIngestKey = (message: SunriseTelemetryMessage): SunriseTelemetryMessage => {
    if (!endpoint || !ingestKey) return message
    return { ...message, ingestKey }
  }

  const send = (message: SunriseTelemetryMessage): void => {
    postToParent(message)
    if (!endpoint) return
    const body = JSON.stringify(withIngestKey(message))
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body,
      keepalive: true,
      mode: 'no-cors',
      credentials: 'omit',
    }).catch(() => {
      navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }))
    })
  }

  const track = (event: SunriseTelemetryEvent, payload: Record<string, unknown> = {}): void => {
    send({
      source: 'sunrise-farm',
      type: 'event',
      event,
      payload: { ...baseContext(), ...safePayload(payload) },
      sessionId,
      sentAt: Date.now(),
    })
  }

  const milestone = (event: SunriseTelemetryEvent, payload: Record<string, unknown> = {}): void => {
    const key = `sunrise-farm.telemetry.${event}`
    if (milestones.has(event) || safeStorage.getItem(key) === '1') return
    milestones.add(event)
    safeStorage.setItem(key, '1')
    track(event, payload)
  }

  const postSnapshot = (): void => {
    postToParent({
      source: 'sunrise-farm',
      type: 'snapshot',
      snapshot: options.snapshot(),
      sessionId,
      sentAt: Date.now(),
    })
  }

  addEventListener('error', (e) => {
    track('error', {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      error: e.error instanceof Error ? e.error : undefined,
    })
  })

  addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason : { message: String(e.reason) }
    track('unhandled_rejection', { reason })
  })

  addEventListener('message', (e) => {
    if (!isAdminMessage(e.data)) return
    if (e.data.type === 'sunrise:getSnapshot') postSnapshot()
    if (e.data.type === 'sunrise:resetSave') options.reset()
    if (e.data.type === 'sunrise:setTelemetryEndpoint') endpoint = e.data.endpoint || ''
    if (e.data.type === 'sunrise:ping') {
      postToParent({ source: 'sunrise-farm', type: 'pong', sessionId, sentAt: Date.now() })
    }
  })

  window.sunriseFarm = {
    track,
    snapshot: options.snapshot,
    reset: options.reset,
    sessionId,
  }

  postToParent({ source: 'sunrise-farm', type: 'ready', sessionId, sentAt: Date.now() })

  return {
    track,
    milestone,
    configure: (nextEndpoint?: string) => {
      endpoint = nextEndpoint || ''
    },
  }
}
