import assert from 'node:assert/strict'
import test from 'node:test'
import { hashPassword, passwordProblem, verifyPassword } from './passwords.js'

test('rechaza contraseñas cortas, espacios y el propio correo', () => {
  assert.match(passwordProblem('corta', 'persona@reobra.test') ?? '', /12 caracteres/)
  assert.match(passwordProblem('  con-espacios', 'persona@reobra.test') ?? '', /espacios/)
  assert.match(passwordProblem('persona@reobra.test', 'persona@reobra.test') ?? '', /correo/)
  assert.equal(passwordProblem('una-clave-larga', 'persona@reobra.test'), null)
})

test('guarda Argon2id y no acepta otra contraseña', async () => {
  const hash = await hashPassword('una-clave-larga')
  assert.match(hash, /^\$argon2id\$/)
  assert.equal(hash.includes('una-clave-larga'), false)
  assert.equal(await verifyPassword(hash, 'una-clave-larga'), true)
  assert.equal(await verifyPassword(hash, 'otra-clave-larga'), false)
  assert.equal(await verifyPassword('no-es-un-hash', 'una-clave-larga'), false)
})
