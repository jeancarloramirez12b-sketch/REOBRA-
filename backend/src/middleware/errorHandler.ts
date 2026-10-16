import type { ErrorRequestHandler } from 'express'
import { AppError } from '../errors/AppError.js'

type JsonParseError = SyntaxError & { type?: string }

function isJsonParseError(error: unknown): error is JsonParseError {
  return error instanceof SyntaxError && (error as JsonParseError).type === 'entity.parse.failed'
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isJsonParseError(error)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'El cuerpo de la solicitud no es JSON válido.',
      },
    })
    return
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      console.error(`[error] ${error.code}`)
    }

    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    })
    return
  }

  console.error('[error] Error interno no controlado.')
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno.',
    },
  })
}
