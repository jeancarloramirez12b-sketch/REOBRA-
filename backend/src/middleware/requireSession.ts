import type { RequestHandler } from 'express'
import { AppError } from '../errors/AppError.js'
import { readCookie, sessionCookieName, writeSessionCookies } from '../modules/auth/cookies.js'
import { authenticateRequest, type SessionAuth } from '../modules/auth/session.service.js'
import { asyncHandler } from './asyncHandler.js'

export function requireSession(secureCookies: boolean): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const token = readCookie(req.headers.cookie, sessionCookieName)
    const result = await authenticateRequest(token, req.get('x-csrf-token') ?? null, req.method)
    if (result.replacement) {
      writeSessionCookies(res, result.replacement.token, result.replacement.csrf, secureCookies)
    }
    res.locals.auth = result.auth
    next()
  })
}

export function optionalSession(secureCookies: boolean): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const token = readCookie(req.headers.cookie, sessionCookieName)
    if (!token) {
      next()
      return
    }
    try {
      const result = await authenticateRequest(token, req.get('x-csrf-token') ?? null, 'GET')
      if (result.replacement) {
        writeSessionCookies(res, result.replacement.token, result.replacement.csrf, secureCookies)
      }
      res.locals.auth = result.auth
    } catch {
      // Una cookie vencida no impide la consulta pública.
    }
    next()
  })
}

export function getAuth(res: { locals: Record<string, unknown> }): SessionAuth {
  const auth = res.locals.auth
  if (!auth || typeof auth !== 'object') {
    throw new AppError(401, 'UNAUTHENTICATED', 'Necesitas iniciar sesión.')
  }
  return auth as SessionAuth
}
