import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth, optionalSession, requireSession } from '../../middleware/requireSession.js'
import { parseOperationKey } from '../passports/validation.js'
import {
  changeNeedStatus,
  changeProjectStatus,
  createNeed,
  createProject,
  getNeed,
  getProject,
  getPublicProject,
  listNeeds,
  listProjects,
  updateNeed,
  updateProject,
} from './project.service.js'
import { isNeedStatus, isProjectStatus } from './states.js'
import {
  parseCreateNeed,
  parseCreateProject,
  parseNeedQuery,
  parseProjectQuery,
  parseProjectStatus,
  parsePublicProjectCode,
  parseUpdateNeed,
  parseUpdateProject,
} from './validation.js'

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

function operationKey(req: { get(name: string): string | undefined }, suffix: string): string {
  const header = parseOperationKey(req.get('idempotency-key'))
  return header ? `${header}-${suffix}` : `op${randomBytes(16).toString('hex')}-${suffix}`
}

export function createProjectsRouter(secureCookies: boolean): Router {
  const router = Router()
  const session = requireSession(secureCookies)
  const optional = optionalSession(secureCookies)

  router.get(
    '/',
    session,
    asyncHandler(async (req, res) => {
      const page = await listProjects(getAuth(res).id, parseProjectQuery(req.query as Record<string, unknown>))
      res.status(200).json({ success: true, data: page })
    }),
  )

  router.post(
    '/',
    session,
    asyncHandler(async (req, res) => {
      const created = await createProject(getAuth(res).id, parseCreateProject(req.body), operationKey(req, 'create'))
      res.status(201).json({ success: true, data: created })
    }),
  )

  router.get(
    '/public/:publicCode',
    optional,
    asyncHandler(async (req, res) => {
      const userId = res.locals.auth ? getAuth(res).id : null
      const payload = await getPublicProject(userId, parsePublicProjectCode(req.params.publicCode))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.get(
    '/:projectId',
    session,
    asyncHandler(async (req, res) => {
      const payload = await getProject(getAuth(res).id, resourceId(req.params.projectId))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.patch(
    '/:projectId',
    session,
    asyncHandler(async (req, res) => {
      const payload = await updateProject(
        getAuth(res).id,
        resourceId(req.params.projectId),
        parseUpdateProject(req.body),
        operationKey(req, 'update'),
      )
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.post(
    '/:projectId/status',
    session,
    asyncHandler(async (req, res) => {
      const input = parseProjectStatus(req.body)
      if (!isProjectStatus(input.status)) {
        throw new AppError(400, 'INVALID_INPUT', 'El estado del proyecto no es válido.')
      }
      const payload = await changeProjectStatus(getAuth(res).id, resourceId(req.params.projectId), input.status, operationKey(req, 'status'))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.post(
    '/:projectId/archive',
    session,
    asyncHandler(async (req, res) => {
      const payload = await changeProjectStatus(getAuth(res).id, resourceId(req.params.projectId), 'archived', operationKey(req, 'archive'))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.get(
    '/:projectId/needs',
    session,
    asyncHandler(async (req, res) => {
      const page = await listNeeds(getAuth(res).id, resourceId(req.params.projectId), parseNeedQuery(req.query as Record<string, unknown>))
      res.status(200).json({ success: true, data: page })
    }),
  )

  router.post(
    '/:projectId/needs',
    session,
    asyncHandler(async (req, res) => {
      const created = await createNeed(getAuth(res).id, resourceId(req.params.projectId), parseCreateNeed(req.body), operationKey(req, 'need'))
      res.status(201).json({ success: true, data: created })
    }),
  )

  return router
}

export function createNeedsRouter(secureCookies: boolean): Router {
  const router = Router()
  const session = requireSession(secureCookies)

  router.get(
    '/:needId',
    session,
    asyncHandler(async (req, res) => {
      const payload = await getNeed(getAuth(res).id, resourceId(req.params.needId))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.patch(
    '/:needId',
    session,
    asyncHandler(async (req, res) => {
      const payload = await updateNeed(getAuth(res).id, resourceId(req.params.needId), parseUpdateNeed(req.body), operationKey(req, 'need-edit'))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.post(
    '/:needId/close',
    session,
    asyncHandler(async (req, res) => {
      const payload = await changeNeedStatus(getAuth(res).id, resourceId(req.params.needId), 'satisfied', operationKey(req, 'close'))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.post(
    '/:needId/cancel',
    session,
    asyncHandler(async (req, res) => {
      const payload = await changeNeedStatus(getAuth(res).id, resourceId(req.params.needId), 'cancelled', operationKey(req, 'cancel'))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  router.post(
    '/:needId/status',
    session,
    asyncHandler(async (req, res) => {
      const status = typeof req.body?.status === 'string' ? req.body.status : ''
      if (status !== 'open' && status !== 'paused' && status !== 'draft') {
        throw new AppError(400, 'INVALID_INPUT', 'Usa las acciones de cerrar o cancelar para esos estados.')
      }
      if (!isNeedStatus(status)) {
        throw new AppError(400, 'INVALID_INPUT', 'El estado de la necesidad no es válido.')
      }
      const payload = await changeNeedStatus(getAuth(res).id, resourceId(req.params.needId), status, operationKey(req, 'need-status'))
      res.status(200).json({ success: true, data: payload })
    }),
  )

  return router
}
