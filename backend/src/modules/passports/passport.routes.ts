import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import multer from 'multer'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth, optionalSession, requireSession } from '../../middleware/requireSession.js'
import { maxDocumentBytes } from './document-storage.js'
import {
  addPassportDocument,
  getPassport,
  listEvents,
  listPassports,
  newOperationKey,
  openPassportImage,
  passportQr,
  readPassportDocument,
  removePassportDocument,
  reviewPassportDocument,
  setPassportVisibility,
} from './passport.service.js'
import {
  parseEventQuery,
  parseEvidenceFields,
  parseOperationKey,
  parsePassportQuery,
  parsePublicCode,
  parseReview,
  parseVisibility,
} from './validation.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxDocumentBytes, files: 1, fields: 4 },
})

const hits = new Map<string, { count: number; reset: number }>()

function limitPublicReads(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.auth) {
    next()
    return
  }
  const now = Date.now()
  const key = req.ip || 'desconocida'
  const current = hits.get(key)
  if (!current || current.reset < now) {
    hits.set(key, { count: 1, reset: now + 60_000 })
    next()
    return
  }
  current.count += 1
  if (current.count > 120) {
    next(new AppError(429, 'TOO_MANY_REQUESTS', 'Demasiadas consultas del pasaporte. Espera un momento.'))
    return
  }
  next()
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

function receiveDocument(req: Request, res: Response, next: NextFunction): void {
  upload.single('document')(req, res, (error: unknown) => {
    if (!error) {
      next()
      return
    }
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (code === 'LIMIT_FILE_SIZE') {
      next(new AppError(400, 'INVALID_INPUT', 'El documento supera el tamaño permitido de 8 MB.'))
      return
    }
    next(new AppError(400, 'INVALID_INPUT', 'No se pudo leer el documento.'))
  })
}

function operationKey(req: Request): string {
  const header = req.get('idempotency-key')
  return parseOperationKey(header) ?? newOperationKey()
}

export function createPassportsRouter(secureCookies: boolean): Router {
  const router = Router()
  const session = requireSession(secureCookies)
  const optional = optionalSession(secureCookies)

  router.get(
    '/',
    session,
    asyncHandler(async (req, res) => {
      const page = await listPassports(getAuth(res).id, parsePassportQuery(req.query as Record<string, unknown>))
      res.status(200).json({ success: true, data: page })
    }),
  )

  router.get(
    '/:publicCode',
    optional,
    limitPublicReads,
    asyncHandler(async (req, res) => {
      const userId = res.locals.auth ? getAuth(res).id : null
      const passport = await getPassport(parsePublicCode(req.params.publicCode), userId, req.app.locals.frontendOrigin as string)
      res.status(200).json({ success: true, data: { passport } })
    }),
  )

  router.get(
    '/:publicCode/events',
    session,
    asyncHandler(async (req, res) => {
      const query = parseEventQuery(req.query as Record<string, unknown>)
      const page = await listEvents(parsePublicCode(req.params.publicCode), getAuth(res).id, query.page, query.pageSize)
      res.status(200).json({ success: true, data: page })
    }),
  )

  router.get(
    '/:publicCode/evidence',
    optional,
    limitPublicReads,
    asyncHandler(async (req, res) => {
      const userId = res.locals.auth ? getAuth(res).id : null
      const passport = await getPassport(parsePublicCode(req.params.publicCode), userId, req.app.locals.frontendOrigin as string)
      res.status(200).json({ success: true, data: { documents: passport.documents } })
    }),
  )

  router.get(
    '/:publicCode/evidence/:documentId',
    optional,
    limitPublicReads,
    asyncHandler(async (req, res) => {
      const userId = res.locals.auth ? getAuth(res).id : null
      const opened = await readPassportDocument(parsePublicCode(req.params.publicCode), resourceId(req.params.documentId), userId)
      res.status(200)
      res.setHeader('Content-Type', opened.contentType)
      res.setHeader('Content-Disposition', `attachment; filename="${opened.filename}"`)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      opened.stream.pipe(res)
    }),
  )

  router.post(
    '/:publicCode/evidence',
    session,
    receiveDocument,
    asyncHandler(async (req, res) => {
      const file = (req as Request & { file?: { buffer?: Buffer; originalname?: string } }).file
      if (!file?.buffer || file.buffer.length === 0) {
        throw new AppError(400, 'INVALID_INPUT', 'Adjunta un PDF, JPEG, PNG o WebP.')
      }
      const fields = parseEvidenceFields(req.body?.evidenceKind, req.body?.disclosure)
      const document = await addPassportDocument(
        getAuth(res).id,
        parsePublicCode(req.params.publicCode),
        file.buffer,
        file.originalname ?? 'documento',
        fields.evidenceKind,
        fields.disclosure,
      )
      res.status(201).json({ success: true, data: { document } })
    }),
  )

  router.patch(
    '/:publicCode/evidence/:documentId',
    session,
    asyncHandler(async (req, res) => {
      const review = parseReview(req.body)
      const document = await reviewPassportDocument(
        getAuth(res).id,
        parsePublicCode(req.params.publicCode),
        resourceId(req.params.documentId),
        review.reviewStatus,
      )
      res.status(200).json({ success: true, data: { document } })
    }),
  )

  router.delete(
    '/:publicCode/evidence/:documentId',
    session,
    asyncHandler(async (req, res) => {
      await removePassportDocument(getAuth(res).id, parsePublicCode(req.params.publicCode), resourceId(req.params.documentId))
      res.status(200).json({ success: true, data: { removed: true } })
    }),
  )

  router.patch(
    '/:publicCode/visibility',
    session,
    asyncHandler(async (req, res) => {
      const input = parseVisibility(req.body)
      const result = await setPassportVisibility(getAuth(res).id, parsePublicCode(req.params.publicCode), input.visibility, operationKey(req))
      res.status(200).json({ success: true, data: result })
    }),
  )

  router.get(
    '/:publicCode/qr',
    optional,
    limitPublicReads,
    asyncHandler(async (req, res) => {
      const userId = res.locals.auth ? getAuth(res).id : null
      const image = await passportQr(parsePublicCode(req.params.publicCode), userId, req.app.locals.frontendOrigin as string)
      res.status(200)
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
      res.setHeader('Content-Disposition', 'inline; filename="pasaporte.svg"')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.send(image.svg)
    }),
  )

  router.get(
    '/:publicCode/images/:imageId',
    optional,
    limitPublicReads,
    asyncHandler(async (req, res) => {
      const userId = res.locals.auth ? getAuth(res).id : null
      const opened = await openPassportImage(parsePublicCode(req.params.publicCode), resourceId(req.params.imageId), userId)
      res.status(200)
      res.setHeader('Content-Type', opened.contentType)
      res.setHeader('Content-Disposition', 'inline')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      opened.stream.pipe(res)
    }),
  )

  return router
}
