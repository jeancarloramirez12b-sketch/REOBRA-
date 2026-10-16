import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { Express } from 'express'

process.env.PORT ??= '3001'
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173'

let app: Express

test.before(async () => {
  const { getConfig } = await import('./config/env.js')
  const { createApp } = await import('./app.js')
  app = createApp(getConfig())
})

test.after(async () => {
  const { closePool } = await import('./config/database.js')
  await closePool()
})

function isAddressInfo(value: string | AddressInfo | null): value is AddressInfo {
  return typeof value === 'object' && value !== null
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server: Server = app.listen(0, '127.0.0.1')

  try {
    await once(server, 'listening')
    const address = server.address()
    if (!isAddressInfo(address)) {
      throw new Error('No se pudo determinar el puerto de prueba.')
    }
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

test('GET /api/health responde sin depender de MySQL', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/api/health`)
    const body: unknown = await response.json()

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /application\/json/)
    assert.ok(isRecord(body))
    assert.equal(body.success, true)
    assert.ok(isRecord(body.data))
    assert.equal(body.data.status, 'ok')
    assert.equal(body.data.service, 'reobra-backend')
    assert.equal(typeof body.data.timestamp, 'string')
    assert.equal(Number.isNaN(Date.parse(String(body.data.timestamp))), false)
  })
})

test('CORS solo refleja el origen configurado', async () => {
  await withServer(async (url) => {
    const allowed = await fetch(`${url}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    })
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')

    const blocked = await fetch(`${url}/api/health`, {
      headers: { Origin: 'http://malicioso.example' },
    })
    assert.notEqual(blocked.headers.get('access-control-allow-origin'), 'http://malicioso.example')
  })
})

test('una ruta inexistente responde JSON controlado', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/api/no-existe`)
    const body: unknown = await response.json()

    assert.equal(response.status, 404)
    assert.ok(isRecord(body))
    assert.equal(body.success, false)
    assert.ok(isRecord(body.error))
    assert.equal(body.error.code, 'NOT_FOUND')
    assert.equal('stack' in body, false)
    assert.equal('stack' in body.error, false)
  })
})

test('un JSON inválido no expone el error interno', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{',
    })
    const body: unknown = await response.json()

    assert.equal(response.status, 400)
    assert.ok(isRecord(body))
    assert.equal(body.success, false)
    assert.ok(isRecord(body.error))
    assert.equal(body.error.code, 'INVALID_JSON')
    assert.equal('stack' in body, false)
  })
})

test('GET /api/health/db responde sin exponer credenciales y no bloquea /api/health', async () => {
  await withServer(async (url) => {
    const databaseResponse = await fetch(`${url}/api/health/db`)
    const databaseBody: unknown = await databaseResponse.json()
    const serialized = JSON.stringify(databaseBody)

    assert.ok(databaseResponse.status === 200 || databaseResponse.status === 503)
    assert.ok(isRecord(databaseBody))
    assert.equal('stack' in databaseBody, false)

    if (databaseResponse.status === 200) {
      assert.equal(databaseBody.success, true)
      assert.ok(isRecord(databaseBody.data))
      assert.equal(databaseBody.data.status, 'ok')
      assert.equal(databaseBody.data.database, 'connected')
    } else {
      assert.equal(databaseBody.success, false)
      assert.ok(isRecord(databaseBody.error))
      assert.ok(
        databaseBody.error.code === 'DATABASE_UNAVAILABLE' ||
          databaseBody.error.code === 'DATABASE_NOT_CONFIGURED',
      )
      assert.equal('stack' in databaseBody.error, false)
    }

    for (const secret of [process.env.DB_PASSWORD, process.env.DB_USER, process.env.DB_NAME]) {
      if (secret) {
        assert.equal(serialized.includes(secret), false)
      }
    }

    const healthResponse = await fetch(`${url}/api/health`)
    assert.equal(healthResponse.status, 200)
  })
})
