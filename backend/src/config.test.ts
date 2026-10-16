import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseConfigError, readDatabaseConfig } from './config/database.js'
import { parseConfig } from './config/env.js'

test('parseConfig normaliza el origen permitido para CORS', () => {
  const config = parseConfig({
    NODE_ENV: 'test',
    PORT: '3001',
    FRONTEND_ORIGIN: 'http://localhost:5173/app',
  })

  assert.equal(config.nodeEnv, 'test')
  assert.equal(config.port, 3001)
  assert.equal(config.frontendOrigin, 'http://localhost:5173')
})

test('parseConfig rechaza un origen inválido sin repetir el valor recibido', () => {
  assert.throws(
    () =>
      parseConfig({
        NODE_ENV: 'test',
        PORT: '3001',
        FRONTEND_ORIGIN: 'no-es-una-url',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /FRONTEND_ORIGIN/)
      assert.equal(error.message.includes('no-es-una-url'), false)
      return true
    },
  )
})

test('readDatabaseConfig informa variables ausentes sin incluir sus valores', () => {
  assert.throws(
    () =>
      readDatabaseConfig({
        DB_HOST: 'localhost',
        DB_PORT: '3306',
      }),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseConfigError)
      assert.deepEqual(error.details, ['DB_USER', 'DB_PASSWORD', 'DB_NAME'])
      assert.equal(error.message.includes('localhost'), false)
      return true
    },
  )
})

test('readDatabaseConfig acepta una clave vacía si la variable existe', () => {
  const config = readDatabaseConfig({
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'reobra_user',
    DB_PASSWORD: '',
    DB_NAME: 'reobra',
  })

  assert.equal(config.password, '')
  assert.equal(config.port, 3306)
  assert.equal(config.database, 'reobra')
})

test('readDatabaseConfig rechaza un puerto no numérico', () => {
  assert.throws(
    () =>
      readDatabaseConfig({
        DB_HOST: 'localhost',
        DB_PORT: 'abc',
        DB_USER: 'reobra_user',
        DB_PASSWORD: 'x',
        DB_NAME: 'reobra',
      }),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseConfigError)
      assert.ok(error.details.includes('DB_PORT'))
      assert.equal(JSON.stringify(error.details).includes('abc'), false)
      return true
    },
  )
})
