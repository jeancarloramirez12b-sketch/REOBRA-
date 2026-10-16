import { Router } from 'express'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth, requireSession } from '../../middleware/requireSession.js'
import { changePassword, listMemberships, loginAccount, registerAccount, requestIp, updateProfile } from './account.service.js'
import { clearSessionCookies, writeSessionCookies } from './cookies.js'
import { revokeSession } from './session.service.js'
import { changePasswordSchema, loginSchema, parseInput, profileSchema, registerSchema } from './validation.js'

function clientAddress(value: string | undefined): string {
  return requestIp(value)
}

export function createAuthRouter(secureCookies: boolean): Router {
  const router = Router()
  const protectedRoute = requireSession(secureCookies)

  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const input = parseInput(registerSchema, req.body)
      const result = await registerAccount({
        fullName: input.fullName,
        email: input.email,
        password: input.password,
        ip: clientAddress(req.ip || req.socket.remoteAddress),
      })
      writeSessionCookies(res, result.session.token, result.session.csrf, secureCookies)
      res.status(201).json({
        success: true,
        data: { user: result.user, memberships: result.memberships },
      })
    }),
  )

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const input = parseInput(loginSchema, req.body)
      const result = await loginAccount({
        email: input.email,
        password: input.password,
        ip: clientAddress(req.ip || req.socket.remoteAddress),
      })
      writeSessionCookies(res, result.session.token, result.session.csrf, secureCookies)
      res.status(200).json({
        success: true,
        data: { user: result.user, memberships: result.memberships },
      })
    }),
  )

  router.post(
    '/logout',
    protectedRoute,
    asyncHandler(async (_req, res) => {
      const auth = getAuth(res)
      await revokeSession(auth.sessionId)
      clearSessionCookies(res, secureCookies)
      res.status(200).json({ success: true, data: { ended: true } })
    }),
  )

  router.get(
    '/me',
    protectedRoute,
    asyncHandler(async (_req, res) => {
      const auth = getAuth(res)
      const memberships = await listMemberships(auth.id)
      res.status(200).json({
        success: true,
        data: {
          user: {
            id: auth.id,
            fullName: auth.fullName,
            email: auth.email,
            phone: auth.phone,
            accountStatus: auth.accountStatus,
          },
          memberships,
        },
      })
    }),
  )

  router.post(
    '/change-password',
    protectedRoute,
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const input = parseInput(changePasswordSchema, req.body)
      const session = await changePassword({
        userId: auth.id,
        email: auth.email,
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      })
      writeSessionCookies(res, session.token, session.csrf, secureCookies)
      res.status(200).json({ success: true, data: { changed: true } })
    }),
  )

  return router
}

export function createUsersRouter(): Router {
  const router = Router()

  router.get(
    '/me',
    asyncHandler(async (_req, res) => {
      const auth = getAuth(res)
      res.status(200).json({
        success: true,
        data: {
          user: {
            id: auth.id,
            fullName: auth.fullName,
            email: auth.email,
            phone: auth.phone,
            accountStatus: auth.accountStatus,
          },
        },
      })
    }),
  )

  router.patch(
    '/me',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      rejectSensitiveProfileFields(req.body)
      const input = parseInput(profileSchema, req.body)
      const user = await updateProfile(auth.id, input)
      res.status(200).json({ success: true, data: { user } })
    }),
  )

  return router
}

export function rejectSensitiveProfileFields(body: unknown): void {
  if (!body || typeof body !== 'object') {
    return
  }
  const record = body as Record<string, unknown>
  if ('email' in record || 'password' in record || 'passwordHash' in record || 'accountStatus' in record || 'role' in record) {
    throw new AppError(400, 'INVALID_INPUT', 'Ese dato no se puede modificar desde el perfil.')
  }
}
