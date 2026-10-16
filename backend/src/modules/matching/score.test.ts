import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchingWeights } from './config.js'
import { evaluateMatch, type MatchInput } from './score.js'
import { explainMatch } from './explain.js'

function input(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    sameCategory: true,
    relatedCategory: false,
    sameUnit: true,
    requiredQuantity: 650,
    availableQuantity: 120,
    needCity: 'Cali',
    needDepartment: 'Valle del Cauca',
    materialCity: 'Cali',
    materialDepartment: 'Valle del Cauca',
    requiredCondition: null,
    materialCondition: 'fair',
    specifications: [],
    published: true,
    ...overrides,
  }
}

test('las ponderaciones suman 100 %', () => {
  const total = Object.values(matchingWeights).reduce((sum, weight) => sum + weight, 0)
  assert.equal(Math.round(total * 100), 100)
})

test('una categoría distinta queda fuera antes de puntuar', () => {
  const result = evaluateMatch(input({ sameCategory: false, relatedCategory: false }))
  assert.equal(result.hardPass, false)
  assert.equal(result.classification, 'incompatible')
  assert.equal(result.observedScore, null)
})

test('un material sin disponibilidad no recibe puntuación', () => {
  const result = evaluateMatch(input({ availableQuantity: 0 }))
  assert.equal(result.exclusionCode, 'NOT_AVAILABLE')
})

test('unidades distintas no se convierten', () => {
  const result = evaluateMatch(input({ sameUnit: false }))
  assert.equal(result.exclusionCode, 'INCOMPATIBLE_UNIT')
})

test('la cobertura parcial de 120 sobre 650 es 18,46 % y no reserva', () => {
  const result = evaluateMatch(input())
  assert.equal(result.hardPass, true)
  assert.equal(result.coveragePercent, 18.46)
  assert.equal(result.usableQuantity, 120)
  assert.equal(result.deficitQuantity, 530)
  assert.equal(result.geographyLevel, 'same_municipality')
  assert.equal(result.technicalState, 'unknown')
  assert.ok((result.observedScore ?? 0) < 70)
  const explanation = explainMatch(result, 'unidad')
  assert.match(explanation, /18,46/)
  assert.match(explanation, /530/)
  assert.match(explanation, /no reserva/i)
  assert.doesNotMatch(explanation, /certifica aptitud técnica de forma positiva|apto para uso estructural/)
})

test('la cobertura no supera el 100 %', () => {
  const result = evaluateMatch(input({ requiredQuantity: 100, availableQuantity: 800 }))
  assert.equal(result.coveragePercent, 100)
  assert.equal(result.usableQuantity, 100)
  assert.equal(result.deficitQuantity, 0)
})

test('la ubicación desconocida no suma puntos geográficos', () => {
  const result = evaluateMatch(input({ needCity: null }))
  const geography = result.factors.find((item) => item.key === 'geography')
  assert.equal(geography?.state, 'unknown')
  assert.equal(geography?.contribution, 0)
  assert.equal(result.geographyLevel, 'unknown')
})

test('un requisito declarado sin dato queda como información insuficiente', () => {
  const result = evaluateMatch(input({ specifications: [{ name: 'Uso previsto', value: 'Divisiones interiores' }] }))
  assert.equal(result.classification, 'insufficient')
  assert.equal(result.compatibilityScore, null)
  assert.equal(result.storedStatus, 'pending')
  assert.ok((result.observedScore ?? 0) > 0)
})

test('un requisito de condición que no coincide se excluye', () => {
  const result = evaluateMatch(input({
    materialCondition: 'fair',
    specifications: [{ name: 'Condición', value: 'Buena' }],
  }))
  assert.equal(result.exclusionCode, 'TECHNICAL_MISMATCH')
})

test('la fórmula aplica las ponderaciones cuando todos los factores se conocen', () => {
  const result = evaluateMatch(input({
    specifications: [{ name: 'Condición', value: 'Aceptable' }],
    materialCondition: 'fair',
  }))
  const expected = Math.round((0.3 * 100 + 0.25 * 18.46 + 0.15 * 100 + 0.2 * 100 + 0.1 * 100) * 100) / 100
  assert.equal(result.technicalState, 'known')
  assert.equal(result.observedScore, expected)
  assert.equal(result.evaluableRatio, 100)
  assert.equal(result.classification, 'high')
})
