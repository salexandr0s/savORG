/**
 * Request Actor Extraction
 *
 * Extract actor information for attribution.
 * Header-based actor overrides are trusted only when explicitly enabled.
 */

import type { NextRequest } from 'next/server'

export interface ActorInfo {
  /** Formatted actor string matching existing patterns (e.g., 'user', 'system', 'agent:build-worker') */
  actor: string
  actorType: 'user' | 'system' | 'agent'
  actorId?: string
}

export interface GetRequestActorOptions {
  /**
   * Trust x-clawcontrol-actor-* headers.
   * Only enable this after request authentication has already passed.
   */
  trustHeaders?: boolean
  /**
   * Actor to return when header overrides are not trusted/present.
   * Defaults to user/operator context.
   */
  fallback?: ActorInfo
}

/**
 * Extract actor from request headers.
 *
 * Headers:
 * - x-clawcontrol-actor-id: The actor identifier (e.g., 'build-worker', 'admin')
 * - x-clawcontrol-actor-type: The actor type ('user' | 'system' | 'agent')
 *
 * Formats the actor string according to existing patterns:
 * - type='user' -> 'user'
 * - type='system' -> 'system'
 * - type='agent' -> 'agent:<actorId>'
 *
 * Falls back to user/operator attribution unless configured otherwise.
 */
export function getRequestActor(request: NextRequest, options?: GetRequestActorOptions): ActorInfo {
  const fallback = options?.fallback ?? { actor: 'user', actorType: 'user', actorId: 'operator' }
  if (!options?.trustHeaders) {
    return fallback
  }

  const actorId = request.headers.get('x-clawcontrol-actor-id')
  const actorType = request.headers.get('x-clawcontrol-actor-type') as 'user' | 'system' | 'agent' | null

  // Default to the authenticated caller context when no trusted actor headers are provided.
  if (!actorType && !actorId) {
    return fallback
  }

  // If only actorId is provided, assume it's a user
  if (!actorType && actorId) {
    return { actor: 'user', actorType: 'user', actorId }
  }

  // Format actor string based on type
  switch (actorType) {
    case 'agent':
      return {
        actor: actorId ? `agent:${actorId}` : 'agent:unknown',
        actorType: 'agent',
        actorId: actorId ?? undefined,
      }
    case 'system':
      return { actor: 'system', actorType: 'system' }
    case 'user':
    default:
      return { actor: 'user', actorType: 'user', actorId: actorId ?? fallback.actorId }
  }
}
