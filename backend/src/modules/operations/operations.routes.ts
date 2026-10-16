import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth, requireSession } from '../../middleware/requireSession.js'
import { parseOperationKey } from '../passports/validation.js'
import { maxDocumentBytes } from '../passports/document-storage.js'
import {
  acceptRequest,
  addOperationDocument,
  cancelRequest,
  counterRequest,
  createRequest,
  dispatchRequest,
  expireRequest,
  getOperation,
  listNotifications,
  listRequests,
  markNotificationRead,
  openIncident,
  openOperationDocument,
  receiveDelivery,
  rejectRequest,
  requestContext,
  resolveIncident,
  reviewRequest,
  submitRequest,
  updateLogistics,
} from './operations.service.js'
import {
  parseCounteroffer,
  parseCreateOperation,
  parseIncident,
  parseLogistics,
  parseMovement,
  parseRequestQuery,
  parseResolution,
} from './validation.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxDocumentBytes, files: 1 } })

function resourceId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !/^[1-9]\d*$/.test(raw)) {
    throw new AppError(404, 'NOT_FOUND', 'No se encontró la operación.')
  }
  return Number(raw)
}

function operationKey(req: { get(name: string): string | undefined }, suffix: string): string {
  const header = parseOperationKey(req.get('idempotency-key'))
  return header ? `${header}-${suffix}` : `op${randomBytes(12).toString('hex')}-${suffix}`
}

export function createOperationsRouter(secureCookies: boolean): Router {
  const router = Router()
  const session = requireSession(secureCookies)

  router.get('/context', session, asyncHandler(async (req, res) => {
    const materialId = resourceId(typeof req.query.materialId === 'string' ? req.query.materialId : undefined)
    const needId = resourceId(typeof req.query.needId === 'string' ? req.query.needId : undefined)
    res.json({ success: true, data: await requestContext(getAuth(res).id, materialId, needId) })
  }))

  router.get('/', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await listRequests(getAuth(res).id, parseRequestQuery(req.query as Record<string, unknown>)) })
  }))

  router.post('/', session, asyncHandler(async (req, res) => {
    const created = await createRequest(getAuth(res).id, parseCreateOperation(req.body), operationKey(req, 'create'))
    res.status(201).json({ success: true, data: created })
  }))

  router.get('/:requestId', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await getOperation(getAuth(res).id, resourceId(req.params.requestId)) })
  }))

  router.post('/:requestId/submit', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await submitRequest(getAuth(res).id, resourceId(req.params.requestId), operationKey(req, 'submit')) })
  }))

  router.post('/:requestId/review', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await reviewRequest(getAuth(res).id, resourceId(req.params.requestId), operationKey(req, 'review')) })
  }))

  router.post('/:requestId/counteroffer', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await counterRequest(getAuth(res).id, resourceId(req.params.requestId), parseCounteroffer(req.body), operationKey(req, 'counter')) })
  }))

  router.post('/:requestId/accept', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await acceptRequest(getAuth(res).id, resourceId(req.params.requestId), operationKey(req, 'accept')) })
  }))

  router.post('/:requestId/reject', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await rejectRequest(getAuth(res).id, resourceId(req.params.requestId), operationKey(req, 'reject')) })
  }))

  router.post('/:requestId/expire', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await expireRequest(getAuth(res).id, resourceId(req.params.requestId), operationKey(req, 'expire')) })
  }))

  router.post('/:requestId/cancel', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await cancelRequest(getAuth(res).id, resourceId(req.params.requestId), operationKey(req, 'cancel')) })
  }))

  router.post('/:requestId/logistics', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await updateLogistics(getAuth(res).id, resourceId(req.params.requestId), parseLogistics(req.body), operationKey(req, 'logistics')) })
  }))

  router.post('/:requestId/dispatch', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dispatchRequest(getAuth(res).id, resourceId(req.params.requestId), parseMovement(req.body), operationKey(req, 'dispatch')) })
  }))

  router.post('/:requestId/deliveries/:deliveryId/receive', session, asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await receiveDelivery(getAuth(res).id, resourceId(req.params.requestId), resourceId(req.params.deliveryId), parseMovement(req.body), operationKey(req, 'receive')),
    })
  }))

  router.post('/:requestId/incidents', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await openIncident(getAuth(res).id, resourceId(req.params.requestId), parseIncident(req.body), operationKey(req, 'incident')) })
  }))

  router.post('/:requestId/incidents/:incidentId/resolve', session, asyncHandler(async (req, res) => {
    const input = parseResolution(req.body)
    res.json({
      success: true,
      data: await resolveIncident(getAuth(res).id, resourceId(req.params.requestId), resourceId(req.params.incidentId), input.resolution, operationKey(req, 'resolve')),
    })
  }))

  router.post('/:requestId/documents', session, upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'INVALID_INPUT', 'Falta el archivo.')
    }
    res.status(201).json({
      success: true,
      data: await addOperationDocument(getAuth(res).id, resourceId(req.params.requestId), req.file.buffer, req.file.originalname),
    })
  }))

  router.get('/:requestId/documents/:documentId', session, asyncHandler(async (req, res) => {
    const opened = await openOperationDocument(getAuth(res).id, resourceId(req.params.requestId), resourceId(req.params.documentId))
    res.setHeader('Content-Type', opened.contentType)
    res.setHeader('Content-Disposition', 'attachment; filename="evidencia"')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    opened.stream.pipe(res)
  }))

  return router
}

export function createNotificationRouter(secureCookies: boolean): Router {
  const router = Router()
  const session = requireSession(secureCookies)
  router.get('/', session, asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await listNotifications(getAuth(res).id) })
  }))
  router.post('/:notificationId/read', session, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await markNotificationRead(getAuth(res).id, resourceId(req.params.notificationId)) })
  }))
  return router
}
