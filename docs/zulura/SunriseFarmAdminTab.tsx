import { useEffect, useMemo, useRef, useState } from 'react'

type SunriseMessage = {
  source: 'sunrise-farm'
  type: 'event' | 'snapshot' | 'ready' | 'pong'
  event?: string
  payload?: Record<string, unknown>
  snapshot?: {
    coins: number
    wheat: number
    level: number
    harvests: number
    day: number
    fieldParcels: number
    chicken: { arrived: boolean; named: boolean; hearts: number; eggsLaid: number }
    townDelivered: number
    playSeconds: number
  }
  sessionId: string
  sentAt: number
}

function isSunriseMessage(value: unknown): value is SunriseMessage {
  return Boolean(value && typeof value === 'object' && (value as SunriseMessage).source === 'sunrise-farm')
}

export function SunriseFarmAdminTab() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [sessionId, setSessionId] = useState<string>('waiting')
  const [snapshot, setSnapshot] = useState<SunriseMessage['snapshot'] | null>(null)
  const [events, setEvents] = useState<SunriseMessage[]>([])
  const gameUrl = useMemo(() => {
    const base = import.meta.env.VITE_SUNRISE_FARM_URL || 'https://sunrise-farm.example.com/'
    return `${base}${base.includes('?') ? '&' : '?'}adminBridge=1`
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isSunriseMessage(event.data)) return
      setSessionId(event.data.sessionId)
      if (event.data.type === 'snapshot') setSnapshot(event.data.snapshot ?? null)
      if (event.data.type === 'event') setEvents((prev) => [event.data, ...prev].slice(0, 50))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const send = (type: string, extra: Record<string, unknown> = {}) => {
    iframeRef.current?.contentWindow?.postMessage({ source: 'zulura-admin', type, ...extra }, '*')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Sunrise Farm soft launch</h2>
            <p className="text-sm text-muted-foreground">Session: {sessionId}</p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-md border px-3 py-2 text-sm" onClick={() => send('sunrise:getSnapshot')}>Refresh snapshot</button>
            <button className="rounded-md border px-3 py-2 text-sm" onClick={() => send('sunrise:ping')}>Ping</button>
          </div>
        </div>
        {snapshot && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
            <div>Coins: {snapshot.coins}</div>
            <div>Wheat: {snapshot.wheat}</div>
            <div>Level: {snapshot.level}</div>
            <div>Harvests: {snapshot.harvests}</div>
            <div>Chicken: {snapshot.chicken.named ? 'named' : snapshot.chicken.arrived ? 'arrived' : 'no'}</div>
          </div>
        )}
      </div>

      <iframe
        ref={iframeRef}
        title="Sunrise Farm"
        src={gameUrl}
        className="h-[760px] w-full rounded-2xl border bg-black"
        allow="fullscreen; autoplay"
      />

      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-2 font-semibold">Latest game events</h3>
        <div className="max-h-72 space-y-2 overflow-auto text-xs">
          {events.map((event, index) => (
            <pre key={`${event.sentAt}-${index}`} className="overflow-auto rounded-md bg-muted p-2">
              {JSON.stringify({ event: event.event, payload: event.payload }, null, 2)}
            </pre>
          ))}
        </div>
      </div>
    </div>
  )
}
