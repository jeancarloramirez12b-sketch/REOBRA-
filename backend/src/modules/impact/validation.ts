import { z } from 'zod'
import { AppError } from '../../errors/AppError.js'

function parseSchema<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Los datos no son válidos.')
  }
  return parsed.data
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha no es válida.')

export function parseImpactQuery(value: Record<string, unknown>): {
  organizationId?: number
  projectId?: number
  from?: string
  to?: string
  grain: 'day' | 'month' | 'year'
} {
  const normalized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const single = Array.isArray(item) ? item[0] : item
    if (single !== '') normalized[key] = single
  }
  const parsed = parseSchema(
    z.object({
      organizationId: z.coerce.number().int().positive().optional(),
      projectId: z.coerce.number().int().positive().optional(),
      from: day.optional(),
      to: day.optional(),
      grain: z.enum(['day', 'month', 'year']).default('month'),
    }),
    normalized,
  )
  if (parsed.from && parsed.to && parsed.to < parsed.from) {
    throw new AppError(400, 'INVALID_INPUT', 'El período termina antes de empezar.')
  }
  return parsed
}

export function parseMethodology(value: unknown): { organizationId: number; name: string; versionLabel: string; statement: string; limitations: string } {
  return parseSchema(
    z.object({
      organizationId: z.coerce.number().int().positive(),
      name: z.string().trim().min(1).max(160),
      versionLabel: z.string().trim().min(1).max(40),
      statement: z.string().trim().min(1).max(4000),
      limitations: z.string().trim().min(1).max(2000),
    }),
    value,
  )
}

export function parseFactor(value: unknown): {
  methodologyId: number
  impactKind: string
  categoryId?: number
  inputUnitCode: string
  outputUnit: string
  value: number
  sourceName: string
  sourceUrl?: string
  issuerName: string
  year: number
  regionName: string
  versionLabel: string
  conditions: string
  uncertainty?: string
} {
  return parseSchema(
    z.object({
      methodologyId: z.coerce.number().int().positive(),
      impactKind: z.string().trim().min(1).max(40),
      categoryId: z.coerce.number().int().positive().optional(),
      inputUnitCode: z.string().trim().min(1).max(16),
      outputUnit: z.string().trim().min(1).max(40),
      value: z.coerce.number().finite('El valor del factor no es válido.'),
      sourceName: z.string().trim().min(1).max(200),
      sourceUrl: z.string().trim().url('La referencia no es una URL válida.').max(500).optional(),
      issuerName: z.string().trim().min(1).max(200),
      year: z.coerce.number().int().min(1900).max(2200),
      regionName: z.string().trim().min(1).max(120),
      versionLabel: z.string().trim().min(1).max(40),
      conditions: z.string().trim().min(1).max(2000),
      uncertainty: z.string().trim().min(1).max(500).optional(),
    }),
    value,
  )
}

export function parseFactorStatus(value: unknown): { status: 'reviewed' | 'approved' | 'retired' } {
  if (value && typeof value === 'object' && 'value' in value) {
    throw new AppError(400, 'INVALID_INPUT', 'El valor de un factor no se modifica. Crea otra versión.')
  }
  return parseSchema(z.object({ status: z.enum(['reviewed', 'approved', 'retired']) }), value)
}

export function parseMassParameter(value: unknown): { materialId: number; kind: 'mass_per_unit' | 'density' | 'mass_per_area'; magnitude: number; sourceNote: string } {
  return parseSchema(
    z.object({
      materialId: z.coerce.number().int().positive(),
      kind: z.enum(['mass_per_unit', 'density', 'mass_per_area']),
      magnitude: z.coerce.number().positive('La magnitud debe ser mayor que cero.'),
      sourceNote: z.string().trim().min(1).max(500),
    }),
    value,
  )
}

export function parseCalculation(value: unknown): { organizationId: number; projectId?: number; factorId: number; from: string; to: string } {
  return parseSchema(
    z.object({
      organizationId: z.coerce.number().int().positive(),
      projectId: z.coerce.number().int().positive().optional(),
      factorId: z.coerce.number().int().positive(),
      from: day,
      to: day,
    }).refine((item) => item.to >= item.from, { message: 'El período termina antes de empezar.' }),
    value,
  )
}

export function parseReport(value: unknown): { organizationId: number; projectId?: number; from: string; to: string; methodologyId?: number } {
  return parseSchema(
    z.object({
      organizationId: z.coerce.number().int().positive(),
      projectId: z.coerce.number().int().positive().optional(),
      from: day,
      to: day,
      methodologyId: z.coerce.number().int().positive().optional(),
    }).refine((item) => item.to >= item.from, { message: 'El período termina antes de empezar.' }),
    value,
  )
}

export function parseCorrection(value: unknown): { quantity: number; reason: string } {
  return parseSchema(
    z.object({
      quantity: z.coerce.number().positive('La cantidad corregida debe ser mayor que cero.'),
      reason: z.string().trim().min(1).max(500),
    }),
    value,
  )
}
