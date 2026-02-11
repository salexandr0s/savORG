import { NextResponse } from 'next/server'
import { getTailscaleReadinessReport } from '@/lib/system/tailscale-readiness'

export async function GET() {
  try {
    const data = await getTailscaleReadinessReport()
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : 'Failed to compute tailscale readiness report',
      },
      { status: 500 }
    )
  }
}
