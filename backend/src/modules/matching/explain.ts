import type { MatchEvaluation } from './score.js'

const numberFormat = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function percent(value: number): string {
  return numberFormat.format(value)
}

export function explainMatch(evaluation: MatchEvaluation, unitName: string): string {
  if (!evaluation.hardPass) {
    return `${evaluation.exclusionMessage ?? 'El material no supera un requisito obligatorio.'} No se calculó una puntuación. Esta revisión no reserva el material.`
  }
  const category = evaluation.factors.find((item) => item.key === 'category')
  const place = evaluation.factors.find((item) => item.key === 'geography')
  const technical = evaluation.factors.find((item) => item.key === 'technical')
  const coverage = evaluation.coveragePercent ?? 0
  const deficit = evaluation.deficitQuantity ?? 0
  const sentences = [
    category?.summary ?? 'Se comparó la categoría del catálogo.',
    'La unidad es compatible y no se convirtió a otra magnitud.',
    `La cantidad disponible permitiría cubrir aproximadamente el ${percent(coverage)} % de la necesidad.`,
    deficit > 0 ? `Quedarían ${percent(deficit)} ${unitName} sin cubrir.` : 'La cantidad disponible alcanza la cantidad requerida.',
    place?.state === 'unknown' ? 'La ubicación no pudo compararse.' : (place?.summary ?? ''),
    technical?.summary ?? '',
    'Esta coincidencia no certifica aptitud técnica, no descuenta inventario y no reserva el material.',
  ]
  return sentences.filter((item) => item.length > 0).join(' ')
}
