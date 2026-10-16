import { Router } from 'express'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth, requireSession } from '../../middleware/requireSession.js'
import { calculateMatches, getStoredMatch, matchingConfig } from './matching.service.js'
import { parseMatchQuery } from './validation.js'

const hits = new Map<string, { count: number; reset: number }>()

function limit(userId: number, action: string, max: number): void {
  const key = `${userId}:${action}`
  const now = Date.now()
  const current = hits.get(key)
  if (!current || current.reset < now) {
    hits.set(key, { count: 1, reset: now + 60_000 })
    return
  }
  current.count += 1
  if (current.count > max) {
    throw new AppError(429, 'RATE_LIMITED', 'Demasiadas consultas de compatibilidad. Espera un momento.')
  }
}

function resourceId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^[1-9]\d*$/.test(raw)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el recurso.')
  }
  const id = Number(raw)
  if (!Number.isSafeInteger(id)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró el recurso.')
  }
  return id
}

export function createNeedMatchRouter(secureCookies: boolean): Router {
  const router = Router()
  router.get('/:needId/matches', requireSession(secureCookies), asyncHandler(async (req, res) => {
    const auth = getAuth(res)
    limit(auth.id, 'read', 30)
    const result = await calculateMatches(auth.id, resourceId(req.params.needId), parseMatchQuery(req.query), false)
    res.json({ success: true, data: result })
  }))
  router.post('/:needId/matches/recalculate', requireSession(secureCookies), asyncHandler(async (req, res) => {
    const auth = getAuth(res)
    limit(auth.id, 'recalculate', 10)
    const result = await calculateMatches(auth.id, resourceId(req.params.needId), parseMatchQuery(req.query), true)
    res.json({ success: true, data: result })
  }))
  return router
}

export function createMatchRouter(secureCookies: boolean): Router {
  const router = Router()
  router.get('/:matchId', requireSession(secureCookies), asyncHandler(async (req, res) => {
    const auth = getAuth(res)
    limit(auth.id, 'read', 30)
    res.json({ success: true, data: { match: await getStoredMatch(auth.id, resourceId(req.params.matchId)) } })
  }))
  return router
}

export function createMatchingConfigRouter(secureCookies: boolean): Router {
  const router = Router()
  router.get('/config', requireSession(secureCookies), asyncHandler(async (_req, res) => {
    res.json({ success: true, data: matchingConfig() })
  }))
  return router
}
