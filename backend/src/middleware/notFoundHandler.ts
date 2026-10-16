import type { RequestHandler } from 'express'
import { AppError } from '../errors/AppError.js'

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'La ruta solicitada no existe.'))
}
