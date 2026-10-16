import type { Request, Response } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { checkDatabaseConnection } from '../services/health.service.js'

export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'reobra-backend',
      timestamp: new Date().toISOString(),
    },
  })
}

export const getDatabaseHealth = asyncHandler(async (_req, res) => {
  const health = await checkDatabaseConnection()
  res.status(200).json({
    success: true,
    data: {
      status: health.status,
      database: 'connected',
    },
  })
})
