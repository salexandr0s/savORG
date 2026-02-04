import { NextRequest, NextResponse } from 'next/server'
import { getOpenClawCapabilities, clearCapabilitiesCache } from '@/lib/openclaw'

/**
 * GET /api/openclaw/capabilities
 * Returns the detected OpenClaw capabilities.
 *
 * This endpoint probes the OpenClaw CLI to detect which features are available.
 * Results are cached for 60 seconds to avoid excessive probing.
 *
 * Query params:
 * - refresh=1: Force a fresh probe by clearing the cache first
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('refresh') === '1'

  try {
    // Clear cache if refresh requested
    if (forceRefresh) {
      clearCapabilitiesCache()
    }

    const capabilities = await getOpenClawCapabilities()

    return NextResponse.json({
      data: capabilities,
      meta: {
        cacheHit: !forceRefresh, // False if we just cleared the cache
        cacheTtlMs: 60000,
        refreshed: forceRefresh,
      },
    })
  } catch (err) {
    console.error('[api/openclaw/capabilities] Failed to get capabilities:', err)

    return NextResponse.json(
      {
        error: 'Failed to detect OpenClaw capabilities',
        data: {
          version: null,
          available: false,
          plugins: {
            supported: false,
            listJson: false,
            infoJson: false,
            doctor: false,
            install: false,
            enable: false,
            disable: false,
            uninstall: false,
            setConfig: false,
          },
          sources: {
            cli: false,
            http: false,
          },
          probedAt: new Date(),
          degradedReason: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 }
    )
  }
}
