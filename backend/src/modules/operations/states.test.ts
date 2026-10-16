import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canTransition, canTransitionLogistics, coveragePercent } from './states.js'

test('una solicitud rechazada no pasa a despachada', () => {
  assert.equal(canTransition('rejected', 'fulfilled'), false)
  assert.equal(canTransition('submitted', 'fulfilled'), false)
  assert.equal(canTransition('draft', 'accepted'), false)
})

test('la cobertura de 120 sobre 650 es 18,46 %', () => {
  assert.equal(coveragePercent(120, 650), 18.46)
  assert.equal(coveragePercent(800, 100), 100)
})

test('la logística no salta de pendiente a una recepción', () => {
  assert.equal(canTransitionLogistics('pending_coordination', 'scheduled'), true)
  assert.equal(canTransitionLogistics('pending_coordination', 'ready_for_pickup'), false)
})
