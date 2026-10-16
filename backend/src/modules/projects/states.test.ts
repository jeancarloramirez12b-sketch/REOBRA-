import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canTransitionNeed,
  canTransitionProject,
  datesAreOrdered,
  isNeedContentEditable,
  isProjectEditable,
  needDateFitsProject,
} from './states.js'

test('el proyecto solo cambia a un estado permitido', () => {
  assert.equal(canTransitionProject('draft', 'active'), true)
  assert.equal(canTransitionProject('draft', 'completed'), false)
  assert.equal(canTransitionProject('active', 'archived'), true)
  assert.equal(canTransitionProject('archived', 'active'), false)
  assert.equal(canTransitionProject('archived', 'draft'), true)
  assert.equal(isProjectEditable('active'), true)
  assert.equal(isProjectEditable('archived'), false)
  assert.equal(isProjectEditable('completed'), false)
})

test('una necesidad satisfecha no vuelve a abrirse ni se edita', () => {
  assert.equal(canTransitionNeed('open', 'satisfied'), true)
  assert.equal(canTransitionNeed('satisfied', 'open'), false)
  assert.equal(canTransitionNeed('draft', 'satisfied'), false)
  assert.equal(isNeedContentEditable('open'), true)
  assert.equal(isNeedContentEditable('satisfied'), false)
  assert.equal(isNeedContentEditable('cancelled'), false)
})

test('las fechas del proyecto y de la necesidad deben ser coherentes', () => {
  assert.equal(datesAreOrdered('2026-01-01', '2026-12-15'), true)
  assert.equal(datesAreOrdered('2026-12-15', '2026-01-01'), false)
  assert.equal(datesAreOrdered(null, '2026-01-01'), true)
  assert.equal(needDateFitsProject('2026-06-01', '2026-01-01', '2026-12-01'), true)
  assert.equal(needDateFitsProject('2025-12-01', '2026-01-01', null), false)
  assert.equal(needDateFitsProject('2027-01-01', null, '2026-12-01'), false)
})
