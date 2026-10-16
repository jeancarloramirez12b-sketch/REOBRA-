import { coveragePercent } from '../operations/states.js'

export const evidenceLevels = ['declared', 'documented', 'reviewed', 'technically_verified'] as const
export type EvidenceLevel = (typeof evidenceLevels)[number]

export type IndicatorDefinition = {
  code: string
  name: string
  definition: string
  unit: string
  formula: string
  source: string
  evidenceLevel: EvidenceLevel
  limitation: string
}

export const indicatorDefinitions: IndicatorDefinition[] = [
  {
    code: 'received_confirmed',
    name: 'Material recibido y confirmado',
    definition: 'Suma de las cantidades que el destinatario confirmó haber recibido, separada por unidad.',
    unit: 'La unidad del material. No se mezclan unidades distintas.',
    formula: 'Suma de deliveries.received_quantity cuando received_at no es nulo. Cada despacho entra una sola vez.',
    source: 'Recepciones confirmadas de operaciones en las que participa la organización.',
    evidenceLevel: 'declared',
    limitation: 'La confirmación demuestra una declaración de recepción. No demuestra instalación, disposición evitada ni un ahorro de emisiones.',
  },
  {
    code: 'dispatched',
    name: 'Material despachado',
    definition: 'Suma de las salidas registradas por la organización oferente, separada por unidad.',
    unit: 'La unidad del material.',
    formula: 'Suma de deliveries.delivered_quantity con estado delivered.',
    source: 'Despachos de operaciones autorizadas.',
    evidenceLevel: 'declared',
    limitation: 'Una salida no demuestra que el destinatario haya recibido el material.',
  },
  {
    code: 'reserved',
    name: 'Material reservado',
    definition: 'Saldo comprometido del inventario de la organización, todavía no despachado.',
    unit: 'La unidad del material.',
    formula: 'material_quantity_summary.committed_quantity.',
    source: 'Vista de disponibilidad del inventario propio.',
    evidenceLevel: 'declared',
    limitation: 'Una reserva no es una transferencia realizada.',
  },
  {
    code: 'published',
    name: 'Material publicado',
    definition: 'Cantidad declarada en el inventario publicado de la organización.',
    unit: 'La unidad del material.',
    formula: 'materials.quantity de materiales publicados, agrupada por unidad.',
    source: 'Inventario.',
    evidenceLevel: 'declared',
    limitation: 'Publicar un material no significa que haya sido transferido.',
  },
  {
    code: 'available',
    name: 'Material disponible',
    definition: 'Cantidad libre para un acuerdo nuevo en materiales publicados, después de descontar lo entregado y lo comprometido.',
    unit: 'La unidad del material.',
    formula: 'Existencia declarada − entregada − comprometida, solo en materiales publicados.',
    source: 'Vista de disponibilidad.',
    evidenceLevel: 'declared',
    limitation: 'La disponibilidad no es material recibido por un proyecto.',
  },
  {
    code: 'pending_receipt',
    name: 'Pendiente de recepción',
    definition: 'Cantidad despachada que el destinatario todavía no confirmó.',
    unit: 'La unidad del material.',
    formula: 'Cantidad despachada − cantidad recibida, cuando la diferencia es positiva.',
    source: 'Despachos y recepciones de la misma salida.',
    evidenceLevel: 'declared',
    limitation: 'El pendiente no se suma como material aprovechado.',
  },
  {
    code: 'need_coverage',
    name: 'Cobertura de una necesidad',
    definition: 'Cantidad recibida y confirmada para una necesidad, dividida por la cantidad requerida.',
    unit: 'Porcentaje, solo dentro de la misma necesidad y la misma unidad.',
    formula: 'Recibido confirmado / cantidad requerida × 100, con tope de 100.',
    source: 'Necesidad del proyecto y recepciones asociadas.',
    evidenceLevel: 'declared',
    limitation: 'Si la cantidad requerida es cero, la cobertura no se calcula.',
  },
  {
    code: 'agreement_fulfillment',
    name: 'Cumplimiento de un acuerdo',
    definition: 'Cantidad recibida y confirmada dividida por la cantidad acordada de esa operación.',
    unit: 'Porcentaje de la misma operación.',
    formula: 'Recibido confirmado / cantidad acordada × 100.',
    source: 'Acuerdo y recepciones de esa solicitud.',
    evidenceLevel: 'declared',
    limitation: 'No se llama tasa de reciclaje ni residuo evitado.',
  },
  {
    code: 'recovered_mass',
    name: 'Masa recuperada calculable',
    definition: 'Suma en kilogramos de recepciones confirmadas que tienen una conversión exacta o un parámetro de masa declarado.',
    unit: 'Kilogramo.',
    formula: 'Conversión exacta dentro de la dimensión de masa, o parámetro documentado de masa por unidad, densidad o masa por superficie.',
    source: 'Recepciones confirmadas y parámetros de masa registrados.',
    evidenceLevel: 'declared',
    limitation: 'Sin un parámetro sustentado, una unidad de conteo no se convierte a kilogramos.',
  },
  {
    code: 'environmental_estimate',
    name: 'Estimación ambiental',
    definition: 'Cantidad recibida convertible multiplicada por un factor aprobado de la propia organización.',
    unit: 'La unidad de salida del factor.',
    formula: 'Cantidad de entrada convertida × valor del factor. No sustituye un análisis de ciclo de vida.',
    source: 'Recepciones confirmadas, metodología aprobada y factor aprobado.',
    evidenceLevel: 'declared',
    limitation: 'Una estimación no es una certificación ambiental, una huella verificada ni una declaración de neutralidad.',
  },
]

export function sumByUnit(rows: Array<{ unitCode: string; quantity: number }>): Array<{ unitCode: string; quantity: number }> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (!(row.quantity > 0) && row.quantity !== 0) {
      continue
    }
    totals.set(row.unitCode, round3((totals.get(row.unitCode) ?? 0) + row.quantity))
  }
  return [...totals.entries()].map(([unitCode, quantity]) => ({ unitCode, quantity })).sort((left, right) => left.unitCode.localeCompare(right.unitCode))
}

export function ratioPercent(part: number, whole: number): number | null {
  if (!(whole > 0) || !Number.isFinite(part)) {
    return null
  }
  return coveragePercent(part, whole)
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
