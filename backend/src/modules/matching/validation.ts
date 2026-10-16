import { z } from 'zod'
import { AppError } from '../../errors/AppError.js'
import type { MatchQuery } from './matching.service.js'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(10),
  sort: z.enum(['score', 'coverage', 'proximity', 'updated']).default('score'),
  level: z.enum(['high', 'medium', 'low', 'insufficient']).optional(),
  minCoverage: z.coerce.number().min(0).max(100).optional(),
  department: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  pendingTechnical: z.enum(['0', '1']).optional(),
})

export function parseMatchQuery(value: unknown): MatchQuery {
  const parsed = querySchema.safeParse(value ?? {})
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_INPUT', 'Los filtros de compatibilidad no son válidos.')
  }
  return {
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    sort: parsed.data.sort,
    level: parsed.data.level,
    minCoverage: parsed.data.minCoverage,
    department: parsed.data.department,
    category: parsed.data.category,
    pendingTechnical: parsed.data.pendingTechnical === '1',
  }
}
