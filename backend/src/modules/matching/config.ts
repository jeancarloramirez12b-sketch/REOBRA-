export const matchingAlgorithmVersion = 'reobra-match-v1'

export const matchingWeights = {
  category: 0.3,
  quantity: 0.25,
  geography: 0.15,
  technical: 0.2,
  availability: 0.1,
} as const

export const matchingThresholds = {
  high: 70,
  medium: 40,
  minimumEvaluableRatio: 0.55,
} as const

export const matchingDisclaimer =
  'La puntuación compara datos declarados. No certifica seguridad, resistencia ni cumplimiento normativo, y no reserva ni entrega el material.'

export type MatchingFactorKey = keyof typeof matchingWeights
