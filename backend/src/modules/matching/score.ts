import { matchingAlgorithmVersion, matchingThresholds, matchingWeights, type MatchingFactorKey } from './config.js'
import { canonicalCondition, conditionRankOf, isConditionAttribute, samePlace } from './normalize.js'

export type FactorState = 'known' | 'unknown'

export type FactorEvaluation = {
  key: MatchingFactorKey
  weight: number
  state: FactorState
  score: number | null
  contribution: number
  summary: string
}

export type MatchClassification = 'high' | 'medium' | 'low' | 'insufficient' | 'incompatible'

export type StoredCompatibility = 'incompatible' | 'pending' | 'partially_compatible' | 'compatible'

export type Specification = { name: string; value: string }

export type MatchInput = {
  sameCategory: boolean
  relatedCategory: boolean
  sameUnit: boolean
  requiredQuantity: number
  availableQuantity: number
  needCity: string | null
  needDepartment: string | null
  materialCity: string | null
  materialDepartment: string | null
  requiredCondition: string | null
  materialCondition: string | null
  specifications: Specification[]
  published: boolean
}

export type MatchEvaluation = {
  algorithmVersion: string
  hardPass: boolean
  exclusionCode: string | null
  exclusionMessage: string | null
  classification: MatchClassification
  storedStatus: StoredCompatibility
  observedScore: number | null
  compatibilityScore: number | null
  evaluableRatio: number
  coveragePercent: number | null
  usableQuantity: number | null
  deficitQuantity: number | null
  geographyLevel: 'same_municipality' | 'same_department' | 'other_department' | 'unknown'
  technicalState: FactorState
  unresolvedRequirements: string[]
  factors: FactorEvaluation[]
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function factor(key: MatchingFactorKey, state: FactorState, score: number | null, summary: string): FactorEvaluation {
  const weight = matchingWeights[key]
  return {
    key,
    weight,
    state,
    score,
    contribution: state === 'known' && score !== null ? round2(weight * score) : 0,
    summary,
  }
}

function geography(input: MatchInput): { level: MatchEvaluation['geographyLevel']; score: number | null; summary: string } {
  const sameCity = samePlace(input.needCity, input.materialCity)
  const sameDepartment = samePlace(input.needDepartment, input.materialDepartment)
  if (sameCity === null || sameDepartment === null) {
    return { level: 'unknown', score: null, summary: 'No hay municipio y departamento suficientes para comparar la ubicación.' }
  }
  if (sameCity && sameDepartment) {
    return { level: 'same_municipality', score: 100, summary: 'El material y la necesidad están en el mismo municipio.' }
  }
  if (sameDepartment) {
    return { level: 'same_department', score: 60, summary: 'Comparten departamento y están en municipios distintos.' }
  }
  return { level: 'other_department', score: 20, summary: 'Están registrados en departamentos distintos. No se calculó una distancia de viaje.' }
}

function technical(input: MatchInput): {
  state: FactorState
  score: number | null
  summary: string
  unresolved: string[]
  mismatch: string | null
} {
  if (input.specifications.length === 0) {
    return {
      state: 'unknown',
      score: null,
      summary: 'La necesidad no declara requisitos técnicos estructurados. No se confirma compatibilidad técnica.',
      unresolved: [],
      mismatch: null,
    }
  }
  const unresolved: string[] = []
  for (const item of input.specifications) {
    if (!isConditionAttribute(item.name)) {
      unresolved.push(item.name)
      continue
    }
    const required = canonicalCondition(item.value)
    const actual = canonicalCondition(input.materialCondition)
    if (!required || !actual || actual === 'not_declared' || actual === 'mixed') {
      unresolved.push(item.name)
      continue
    }
    if (required !== actual) {
      return {
        state: 'known',
        score: 0,
        summary: 'Un requisito declarado de condición no coincide con el material.',
        unresolved,
        mismatch: item.name,
      }
    }
  }
  if (unresolved.length > 0) {
    return {
      state: 'unknown',
      score: null,
      summary: 'Faltan datos para comprobar uno o más requisitos declarados.',
      unresolved,
      mismatch: null,
    }
  }
  return {
    state: 'known',
    score: 100,
    summary: 'Los requisitos declarados que REOBRA puede comparar coinciden con el material.',
    unresolved: [],
    mismatch: null,
  }
}

export function evaluateMatch(input: MatchInput): MatchEvaluation {
  const base = {
    algorithmVersion: matchingAlgorithmVersion,
    coveragePercent: null,
    usableQuantity: null,
    deficitQuantity: null,
    geographyLevel: 'unknown' as const,
    technicalState: 'unknown' as const,
    unresolvedRequirements: [] as string[],
    factors: [] as FactorEvaluation[],
    evaluableRatio: 0,
    observedScore: null,
    compatibilityScore: null,
  }

  if (!input.published) {
    return { ...base, hardPass: false, exclusionCode: 'NOT_PUBLISHED', exclusionMessage: 'El material no está publicado.', classification: 'incompatible', storedStatus: 'incompatible' }
  }
  if (!(input.availableQuantity > 0)) {
    return { ...base, hardPass: false, exclusionCode: 'NOT_AVAILABLE', exclusionMessage: 'El material no tiene cantidad disponible.', classification: 'incompatible', storedStatus: 'incompatible' }
  }
  if (!input.sameUnit) {
    return { ...base, hardPass: false, exclusionCode: 'INCOMPATIBLE_UNIT', exclusionMessage: 'La unidad no coincide y no hay una conversión aplicada.', classification: 'incompatible', storedStatus: 'incompatible' }
  }
  if (!input.sameCategory && !input.relatedCategory) {
    return { ...base, hardPass: false, exclusionCode: 'INCOMPATIBLE_CATEGORY', exclusionMessage: 'La categoría no está definida como compatible en el catálogo.', classification: 'incompatible', storedStatus: 'incompatible' }
  }

  const requiredRank = conditionRankOf(input.requiredCondition)
  const materialRank = conditionRankOf(input.materialCondition)
  if (requiredRank !== null && materialRank !== null && materialRank < requiredRank && input.requiredCondition === 'good' && input.materialCondition === 'deteriorated') {
    return { ...base, hardPass: false, exclusionCode: 'INCOMPATIBLE_CONDITION', exclusionMessage: 'La condición declarada del material no cumple la condición exigida.', classification: 'incompatible', storedStatus: 'incompatible' }
  }

  const technicalResult = technical(input)
  if (technicalResult.mismatch) {
    return {
      ...base,
      hardPass: false,
      exclusionCode: 'TECHNICAL_MISMATCH',
      exclusionMessage: technicalResult.summary,
      classification: 'incompatible',
      storedStatus: 'incompatible',
      technicalState: 'known',
      unresolvedRequirements: technicalResult.unresolved,
    }
  }

  const usable = Math.min(input.availableQuantity, input.requiredQuantity)
  const coverage = round2((usable / input.requiredQuantity) * 100)
  const deficit = round2(Math.max(input.requiredQuantity - usable, 0))
  const place = geography(input)
  const categoryScore = input.sameCategory ? 100 : 60
  const availabilityScore = requiredRank !== null && materialRank === null ? null : requiredRank !== null && materialRank !== null && materialRank < requiredRank ? 40 : 100

  const factors = [
    factor('category', 'known', categoryScore, input.sameCategory ? 'La categoría del catálogo coincide.' : 'La categoría es la categoría superior o inferior directa en el catálogo.'),
    factor('quantity', 'known', coverage, `La cantidad disponible cubre el ${coverage} % de lo requerido.`),
    factor('geography', place.score === null ? 'unknown' : 'known', place.score, place.summary),
    factor('technical', technicalResult.state, technicalResult.score, technicalResult.summary),
    factor(
      'availability',
      availabilityScore === null ? 'unknown' : 'known',
      availabilityScore,
      availabilityScore === null
        ? 'La necesidad pide una condición y el material no la tiene declarada.'
        : 'El material está publicado y su condición declarada se comparó con la solicitada.',
    ),
  ]
  const evaluableWeight = factors.reduce((sum, item) => sum + (item.state === 'known' ? item.weight : 0), 0)
  const observed = round2(factors.reduce((sum, item) => sum + item.contribution, 0))
  const mandatoryGap = technicalResult.unresolved.length > 0
  const thinEvidence = evaluableWeight < matchingThresholds.minimumEvaluableRatio
  let classification: MatchClassification = 'low'
  if (mandatoryGap || thinEvidence) {
    classification = 'insufficient'
  } else if (observed >= matchingThresholds.high && technicalResult.state === 'known') {
    classification = 'high'
  } else if (observed >= matchingThresholds.medium) {
    classification = 'medium'
  }
  const storedStatus: StoredCompatibility = classification === 'insufficient'
    ? 'pending'
    : coverage >= 100 && classification === 'high'
      ? 'compatible'
      : 'partially_compatible'

  return {
    algorithmVersion: matchingAlgorithmVersion,
    hardPass: true,
    exclusionCode: null,
    exclusionMessage: null,
    classification,
    storedStatus,
    observedScore: observed,
    compatibilityScore: storedStatus === 'pending' ? null : observed,
    evaluableRatio: round2(evaluableWeight * 100),
    coveragePercent: coverage,
    usableQuantity: round2(usable),
    deficitQuantity: deficit,
    geographyLevel: place.level,
    technicalState: technicalResult.state,
    unresolvedRequirements: technicalResult.unresolved,
    factors,
  }
}

export function compareMatches(sort: 'score' | 'coverage' | 'proximity' | 'updated', left: { observedScore: number | null; coveragePercent: number | null; geographyLevel: MatchEvaluation['geographyLevel']; updatedAt: string }, right: typeof left): number {
  if (sort === 'coverage') {
    return (right.coveragePercent ?? -1) - (left.coveragePercent ?? -1)
  }
  if (sort === 'proximity') {
    const rank = { same_municipality: 3, same_department: 2, other_department: 1, unknown: 0 }
    return rank[right.geographyLevel] - rank[left.geographyLevel]
  }
  if (sort === 'updated') {
    return right.updatedAt.localeCompare(left.updatedAt)
  }
  return (right.observedScore ?? -1) - (left.observedScore ?? -1)
}
