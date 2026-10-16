export const availabilityLabels: Record<string, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  paused: 'Retirado temporalmente',
  withdrawn: 'Archivado',
}

export const technicalLabels: Record<string, string> = {
  pending: 'Evaluación pendiente',
  in_review: 'En revisión',
  insufficient_information: 'Información insuficiente',
  not_suitable: 'No apto para el uso declarado',
  conditionally_suitable: 'Apto con condiciones',
  suitable_for_stated_use: 'Apto para el uso declarado',
}

export const conditionLabels: Record<string, string> = {
  not_declared: 'No declarada',
  good: 'Buena',
  fair: 'Aceptable',
  deteriorated: 'Deteriorada',
  mixed: 'Mixta',
}

export const originLabels: Record<string, string> = {
  construction: 'Construcción',
  industrial: 'Industria',
  demolition: 'Demolición',
  other: 'Otra',
}

type Tone = 'neutral' | 'warning' | 'ok' | 'info' | 'danger'

export function availabilityTone(status: string): Tone {
  if (status === 'published') return 'ok'
  if (status === 'paused') return 'warning'
  if (status === 'withdrawn') return 'danger'
  return 'neutral'
}

export function technicalTone(status: string): Tone {
  if (status === 'pending' || status === 'in_review' || status === 'insufficient_information') return 'info'
  if (status === 'not_suitable') return 'danger'
  if (status === 'conditionally_suitable' || status === 'suitable_for_stated_use') return 'warning'
  return 'neutral'
}
