import { NextResponse } from 'next/server'
import { getSyncState } from '@/lib/sync-state'
import { isGatewayOnline } from '@/lib/openclaw-client'

const STALE_AFTER_MS = 10 * 60 * 1000

export async function GET() {
  const state = getSyncState()
  const lastSyncTimestamp = state.lastSync?.timestamp ?? null

  let gatewayConnected = false
  try {
    gatewayConnected = await isGatewayOnline()
  } catch {
    gatewayConnected = false
  }

  const staleMs = lastSyncTimestamp
    ? Date.now() - new Date(lastSyncTimestamp).getTime()
    : null

  const stale = staleMs === null ? true : staleMs > STALE_AFTER_MS

  return NextResponse.json({
    bootSync: state.bootSync,
    lastSync: state.lastSync,
    gatewayConnected,
    stale,
    staleMs,
  })
}
