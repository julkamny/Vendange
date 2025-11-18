import type { ThemeMode } from '../types'

export type BroadcastPayload =
  | { type: 'dataset-update'; datasetId: string; recordIds: string[] }
  | { type: 'theme-change'; theme: ThemeMode }
  | { type: 'shortcut-focus'; windowId: string; active: boolean }

export type BroadcastEvent = BroadcastPayload & { sourceId: string }

const CHANNEL_NAME = 'vendange-ui'
const CLIENT_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `vendange-${Math.random().toString(36).slice(2)}`

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

export function getBroadcastClientId(): string {
  return CLIENT_ID
}

export function postBroadcastEvent(payload: BroadcastPayload): void {
  const bc = getChannel()
  if (!bc) return
  bc.postMessage({ ...payload, sourceId: CLIENT_ID })
}

export function subscribeToBroadcast(handler: (event: BroadcastEvent) => void): () => void {
  const bc = getChannel()
  if (!bc) return () => {}
  const handleMessage = (event: MessageEvent<BroadcastEvent>) => {
    if (!event.data || typeof event.data !== 'object') return
    handler(event.data)
  }
  bc.addEventListener('message', handleMessage)
  return () => {
    bc.removeEventListener('message', handleMessage)
  }
}
