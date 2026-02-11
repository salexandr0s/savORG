import { NextResponse } from 'next/server'
import { issueOperatorSession } from '@/lib/auth/operator-auth'

/**
 * GET /api/auth/bootstrap
 *
 * Issues/refreshes the local operator session cookie and CSRF token.
 */
export async function GET() {
  const response = NextResponse.json({
    success: true,
    csrfToken: '',
    expiresAt: '',
  })
  const issued = issueOperatorSession(response)

  return NextResponse.json(
    { success: true, csrfToken: issued.csrfToken, expiresAt: issued.expiresAt },
    { headers: response.headers }
  )
}
