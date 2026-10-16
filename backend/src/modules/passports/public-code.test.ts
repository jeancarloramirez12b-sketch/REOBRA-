import assert from 'node:assert/strict'
import test from 'node:test'
import { createPublicCode, isPublicCode } from './public-code.js'

test('la identidad pública es opaca, única y no editable por formato', () => {
  const first = createPublicCode()
  const second = createPublicCode()
  assert.equal(isPublicCode(first), true)
  assert.equal(isPublicCode(second), true)
  assert.notEqual(first, second)
  assert.equal(first.startsWith('rob_'), true)
  assert.equal(first.includes('@'), false)
  assert.equal(isPublicCode('rob_CORTO'), false)
  assert.equal(isPublicCode('MAT-000001'), false)
})
