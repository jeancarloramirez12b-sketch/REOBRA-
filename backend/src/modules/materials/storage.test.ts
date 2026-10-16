import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import test from 'node:test'
import { AppError } from '../../errors/AppError.js'
import { detectImage, removeMaterialFile, resolveStoredFile, writeMaterialFile } from './storage.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('solo reconoce JPEG, PNG y WebP por su contenido', () => {
  assert.equal(detectImage(png), 'png')
  assert.equal(detectImage(Buffer.from('esto no es una imagen')), null)
  assert.equal(detectImage(Buffer.from('data:image/png;base64,aaaa')), null)
})

test('rechaza claves que salen del almacenamiento', () => {
  assert.throws(() => resolveStoredFile('data:image/png;base64,aaaa'), AppError)
  assert.throws(() => resolveStoredFile('materials/1/../../secrets.png'), AppError)
  assert.throws(() => resolveStoredFile('materials/1/not-a-uuid.png'), AppError)
  const file = resolveStoredFile('materials/4/11111111-1111-4111-8111-111111111111.png')
  assert.match(file, /storage[/\\]materials[/\\]4[/\\]11111111-1111-4111-8111-111111111111\.png$/)
})

test('guarda una imagen válida y puede retirarla', async () => {
  const key = await writeMaterialFile(4, png)
  assert.match(key, /^materials\/4\/[0-9a-f-]{36}\.png$/)
  const file = resolveStoredFile(key)
  const info = await stat(file)
  assert.equal(info.isFile(), true)
  await removeMaterialFile(key)
  await assert.rejects(() => stat(file))
})
