import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import multer from 'multer'
import { AppError } from '../../errors/AppError.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { getAuth } from '../../middleware/requireSession.js'
import {
  addMaterialImage,
  createMaterial,
  getMaterial,
  listCategories,
  listMaterials,
  listUnits,
  readMaterialImage,
  removeMaterialImage,
  updateMaterial,
  updateMaterialStatus,
} from './material.service.js'
import { maxImageBytes } from './storage.js'
import { getPassportForMaterial, newOperationKey } from '../passports/passport.service.js'
import { parseOperationKey } from '../passports/validation.js'
import { parseCreateMaterial, parseMaterialQuery, parseMaterialStatus, parseUpdateMaterial } from './validation.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxImageBytes, files: 1, fields: 2 },
})

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

function receiveImage(req: Request, res: Response, next: NextFunction): void {
  upload.single('image')(req, res, (error: unknown) => {
    if (!error) {
      next()
      return
    }
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (code === 'LIMIT_FILE_SIZE') {
      next(new AppError(400, 'INVALID_INPUT', 'La imagen supera el tamaño permitido de 5 MB.'))
      return
    }
    next(new AppError(400, 'INVALID_INPUT', 'No se pudo leer la imagen.'))
  })
}

function operationKey(req: Request): string {
  return parseOperationKey(req.get('idempotency-key')) ?? newOperationKey()
}

function imageBuffer(req: Request): Buffer {
  const file = (req as Request & { file?: { buffer?: Buffer } }).file
  if (!file?.buffer || file.buffer.length === 0) {
    throw new AppError(400, 'INVALID_INPUT', 'Adjunta una imagen JPEG, PNG o WebP.')
  }
  return file.buffer
}

export function createMaterialsRouter(): Router {
  const router = Router()

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const query = parseMaterialQuery(req.query as Record<string, unknown>)
      const page = await listMaterials(auth.id, query)
      res.status(200).json({ success: true, data: page })
    }),
  )

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const material = await createMaterial(auth.id, parseCreateMaterial(req.body))
      res.status(201).json({ success: true, data: { material } })
    }),
  )

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const material = await getMaterial(auth.id, resourceId(req.params.id))
      res.status(200).json({ success: true, data: { material } })
    }),
  )

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const material = await updateMaterial(auth.id, resourceId(req.params.id), parseUpdateMaterial(req.body), operationKey(req))
      res.status(200).json({ success: true, data: { material } })
    }),
  )

  router.patch(
    '/:id/status',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const input = parseMaterialStatus(req.body)
      const material = await updateMaterialStatus(auth.id, resourceId(req.params.id), input.availabilityStatus, operationKey(req))
      res.status(200).json({ success: true, data: { material } })
    }),
  )

  router.post(
    '/:id/images',
    receiveImage,
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const image = await addMaterialImage(auth.id, resourceId(req.params.id), imageBuffer(req))
      res.status(201).json({ success: true, data: { image } })
    }),
  )

  router.get(
    '/:id/passport',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const passport = await getPassportForMaterial(auth.id, resourceId(req.params.id), req.app.locals.frontendOrigin as string)
      res.status(200).json({ success: true, data: { passport } })
    }),
  )

  router.get(
    '/:id/images/:imageId',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      const opened = await readMaterialImage(auth.id, resourceId(req.params.id), resourceId(req.params.imageId))
      res.status(200)
      res.setHeader('Content-Type', opened.contentType)
      res.setHeader('Content-Disposition', 'inline')
      opened.stream.on('error', () => {
        if (!res.headersSent) {
          res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'No se encontró la imagen.' },
          })
          return
        }
        res.destroy()
      })
      opened.stream.pipe(res)
    }),
  )

  router.delete(
    '/:id/images/:imageId',
    asyncHandler(async (req, res) => {
      const auth = getAuth(res)
      await removeMaterialImage(auth.id, resourceId(req.params.id), resourceId(req.params.imageId))
      res.status(200).json({ success: true, data: { removed: true } })
    }),
  )

  return router
}

export function createCategoriesRouter(): Router {
  const router = Router()
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const categories = await listCategories()
      res.status(200).json({ success: true, data: { categories } })
    }),
  )
  return router
}

export function createUnitsRouter(): Router {
  const router = Router()
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const units = await listUnits()
      res.status(200).json({ success: true, data: { units } })
    }),
  )
  return router
}
