import { NextResponse } from 'next/server'
import { WORKFLOWS } from '@/lib/workflows/definitions'

export async function GET() {
  return NextResponse.json({
    data: Object.values(WORKFLOWS),
  })
}

