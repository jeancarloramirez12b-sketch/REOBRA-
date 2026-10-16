export type Dimension = 'mass' | 'length' | 'area' | 'volume' | 'count'

const exactToBase: Record<string, { dimension: Dimension; toBase: number }> = {
  g: { dimension: 'mass', toBase: 0.001 },
  kg: { dimension: 'mass', toBase: 1 },
  t: { dimension: 'mass', toBase: 1000 },
  m: { dimension: 'length', toBase: 1 },
  m2: { dimension: 'area', toBase: 1 },
  m3: { dimension: 'volume', toBase: 1 },
  L: { dimension: 'volume', toBase: 0.001 },
  unit: { dimension: 'count', toBase: 1 },
}

export type MassParameterKind = 'mass_per_unit' | 'density' | 'mass_per_area'

export type MassParameter = {
  kind: MassParameterKind
  magnitude: number
}

const notCalculable = 'Masa no calculable con los datos actuales.'

export function dimensionOf(unitCode: string): Dimension | null {
  return exactToBase[unitCode]?.dimension ?? null
}

export function convertExact(quantity: number, from: string, to: string): number | null {
  const source = exactToBase[from]
  const target = exactToBase[to]
  if (!source || !target || source.dimension !== target.dimension) {
    return null
  }
  if (!Number.isFinite(quantity)) {
    return null
  }
  return round((quantity * source.toBase) / target.toBase)
}

export function toKilograms(quantity: number, unitCode: string, parameter: MassParameter | null): { ok: true; kilograms: number } | { ok: false; reason: string } {
  const dimension = dimensionOf(unitCode)
  if (!dimension || !(quantity >= 0)) {
    return { ok: false, reason: notCalculable }
  }
  if (dimension === 'mass') {
    const kilograms = convertExact(quantity, unitCode, 'kg')
    return kilograms === null ? { ok: false, reason: notCalculable } : { ok: true, kilograms }
  }
  if (!parameter || !(parameter.magnitude > 0)) {
    return { ok: false, reason: notCalculable }
  }
  if (dimension === 'count' && parameter.kind === 'mass_per_unit') {
    return { ok: true, kilograms: round(quantity * parameter.magnitude) }
  }
  if (dimension === 'volume' && parameter.kind === 'density') {
    const cubicMeters = convertExact(quantity, unitCode, 'm3')
    return cubicMeters === null ? { ok: false, reason: notCalculable } : { ok: true, kilograms: round(cubicMeters * parameter.magnitude) }
  }
  if (dimension === 'area' && parameter.kind === 'mass_per_area') {
    const squareMeters = convertExact(quantity, unitCode, 'm2')
    return squareMeters === null ? { ok: false, reason: notCalculable } : { ok: true, kilograms: round(squareMeters * parameter.magnitude) }
  }
  return { ok: false, reason: notCalculable }
}

export function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
