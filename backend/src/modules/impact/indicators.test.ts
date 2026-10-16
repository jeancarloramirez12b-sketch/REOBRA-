import assert from 'node:assert/strict'
import test from 'node:test'
import { ratioPercent, sumByUnit } from './indicators.js'
import { convertExact, toKilograms } from './units.js'

test('1000 kg equivalen a 1 t y 1000 g equivalen a 1 kg', () => {
  assert.equal(convertExact(1000, 'kg', 't'), 1)
  assert.equal(convertExact(1000, 'g', 'kg'), 1)
  assert.equal(convertExact(1000, 'L', 'm3'), 1)
})

test('unidades y kilogramos no se convierten sin un parámetro', () => {
  assert.equal(convertExact(35, 'unit', 'kg'), null)
  assert.deepEqual(toKilograms(35, 'unit', null), { ok: false, reason: 'Masa no calculable con los datos actuales.' })
})

test('una masa por unidad declarada convierte solo conteos', () => {
  assert.deepEqual(toKilograms(35, 'unit', { kind: 'mass_per_unit', magnitude: 2 }), { ok: true, kilograms: 70 })
  assert.equal(toKilograms(35, 'unit', { kind: 'density', magnitude: 2 }).ok, false)
})

test('no se suman ladrillos con metros cuadrados', () => {
  assert.deepEqual(sumByUnit([
    { unitCode: 'unit', quantity: 100 },
    { unitCode: 'm2', quantity: 20 },
    { unitCode: 'unit', quantity: 5 },
  ]), [
    { unitCode: 'm2', quantity: 20 },
    { unitCode: 'unit', quantity: 105 },
  ])
})

test('35 recepciones sobre 650 requeridas cubren 5,38 % y un denominador cero no se calcula', () => {
  assert.equal(ratioPercent(35, 650), 5.38)
  assert.equal(ratioPercent(35, 0), null)
})
