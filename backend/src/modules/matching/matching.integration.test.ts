import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import type { Express } from 'express'
import type { RowDataPacket } from 'mysql2'

process.env.NODE_ENV = 'test'
process.env.PORT ??= '3001'
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173'

const password = 'una-clave-larga'
let server: Server
let baseUrl = ''
let ready = false
const createdEmails: string[] = []

class Jar {
  private readonly values = new Map<string, string>()

  store(response: Response): void {
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
    for (const cookie of cookies) {
      const pair = cookie.split(';')[0] ?? ''
      const index = pair.indexOf('=')
      if (index > 0) {
        this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
      }
    }
  }

  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  csrf(): string {
    return this.values.get('reobra_csrf') ?? ''
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function email(label: string): string {
  const value = `fase8-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@reobra.test`
  createdEmails.push(value)
  return value
}

async function call(method: string, path: string, jar: Jar, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = new Headers({ Accept: 'application/json' })
  const cookie = jar.header()
  if (cookie) {
    headers.set('cookie', cookie)
  }
  if (body !== undefined) {
    headers.set('content-type', 'application/json')
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('x-csrf-token', jar.csrf())
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  jar.store(response)
  const payload: unknown = await response.json()
  assert.ok(isRecord(payload))
  return { status: response.status, body: payload }
}

function dataOf(body: Record<string, unknown>): Record<string, unknown> {
  assert.equal(body.success, true)
  assert.ok(isRecord(body.data))
  return body.data
}

async function register(jar: Jar, address: string, name: string): Promise<number> {
  const result = await call('POST', '/api/auth/register', jar, { fullName: name, email: address, password, acceptedTerms: true })
  assert.equal(result.status, 201)
  const me = await call('GET', '/api/auth/me', jar)
  const user = dataOf(me.body).user
  assert.ok(isRecord(user))
  return Number(user.id)
}

async function createOrganization(jar: Jar, address: string, name: string): Promise<number> {
  const result = await call('POST', '/api/organizations', jar, {
    name,
    organizationType: 'company',
    contactEmail: address,
    city: 'Cali',
    department: 'Valle del Cauca',
    country: 'CO',
  })
  assert.equal(result.status, 201)
  const organization = dataOf(result.body).organization
  assert.ok(isRecord(organization))
  return Number(organization.id)
}

before(async () => {
  await import('../../config/env.js')
  const { readDatabaseConfig, closePool } = await import('../../config/database.js')
  if (readDatabaseConfig().database !== 'reobra') {
    throw new Error('Las pruebas de matching usan la base reobra y solo borran correos fase8-…@reobra.test.')
  }
  const { migrateUp } = await import('../../database/migrator.js')
  await migrateUp()
  await closePool()
  const { createApp } = await import('../../app.js')
  const { getConfig } = await import('../../config/env.js')
  const app: Express = createApp(getConfig())
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('No se pudo abrir el servidor de prueba.')
  }
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`
  ready = true
})

after(async () => {
  if (server) {
    server.closeAllConnections()
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
  const { getPool, closePool } = await import('../../config/database.js')
  try {
  if (!ready || createdEmails.length === 0) {
    return
  }
  const { sha256 } = await import('../auth/tokens.js')
  const pool = getPool()
  const [databaseRows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name')
  if (databaseRows[0]?.name !== 'reobra') {
    throw new Error('Se evitó limpiar una base distinta de reobra.')
  }
  const placeholders = createdEmails.map(() => '?').join(', ')
  const [orgRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM organizations WHERE contact_email IN (${placeholders})`, createdEmails)
  const orgIds = orgRows.map((row) => Number(row.id))
  if (orgIds.length > 0) {
    const ids = orgIds.map(() => '?').join(', ')
    const [projectRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM projects WHERE organization_id IN (${ids})`, orgIds)
    const projectIds = projectRows.map((row) => Number(row.id))
    const [materialRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM materials WHERE organization_id IN (${ids})`, orgIds)
    const materialIds = materialRows.map((row) => Number(row.id))
    let needIds: number[] = []
    if (projectIds.length > 0) {
      const projectPlaceholders = projectIds.map(() => '?').join(', ')
      const [needRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM project_material_needs WHERE project_id IN (${projectPlaceholders})`, projectIds)
      needIds = needRows.map((row) => Number(row.id))
    }
    if (needIds.length > 0) {
      const needPlaceholders = needIds.map(() => '?').join(', ')
      await pool.query(`DELETE FROM matching_runs WHERE project_need_id IN (${needPlaceholders})`, needIds)
      await pool.query(`DELETE FROM material_matches WHERE project_need_id IN (${needPlaceholders})`, needIds)
    }
    if (materialIds.length > 0) {
      const materialPlaceholders = materialIds.map(() => '?').join(', ')
      await pool.query(`DELETE FROM material_matches WHERE material_id IN (${materialPlaceholders})`, materialIds)
      await pool.query(`DELETE FROM material_documents WHERE material_id IN (${materialPlaceholders})`, materialIds)
      await pool.query(
        `DELETE revision FROM material_passport_revisions revision
         INNER JOIN material_passports passport ON passport.id = revision.passport_id
         WHERE passport.material_id IN (${materialPlaceholders})`,
        materialIds,
      )
      await pool.query(`DELETE FROM material_passports WHERE material_id IN (${materialPlaceholders})`, materialIds)
      await pool.query(`DELETE FROM material_trace_events WHERE material_id IN (${materialPlaceholders})`, materialIds)
      await pool.query(`DELETE FROM material_images WHERE material_id IN (${materialPlaceholders})`, materialIds)
      await pool.query(`DELETE FROM materials WHERE id IN (${materialPlaceholders})`, materialIds)
    }
    if (projectIds.length > 0) {
      const projectPlaceholders = projectIds.map(() => '?').join(', ')
      await pool.query(`DELETE FROM project_events WHERE project_id IN (${projectPlaceholders})`, projectIds)
      await pool.query(`DELETE FROM project_material_needs WHERE project_id IN (${projectPlaceholders})`, projectIds)
      await pool.query(`DELETE FROM projects WHERE id IN (${projectPlaceholders})`, projectIds)
    }
    const [userRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM users WHERE email IN (${placeholders})`, createdEmails)
    const userIds = userRows.map((row) => Number(row.id))
    if (userIds.length > 0) {
      const users = userIds.map(() => '?').join(', ')
      await pool.query(`DELETE FROM sessions WHERE user_id IN (${users})`, userIds)
      await pool.query(`DELETE FROM organization_members WHERE user_id IN (${users})`, userIds)
    }
    await pool.query(`DELETE FROM organizations WHERE id IN (${ids}) AND id NOT IN (SELECT organization_id FROM organization_members)`, orgIds)
  }
  await pool.query(`DELETE FROM users WHERE email IN (${placeholders})`, createdEmails)
  await pool.query(`DELETE FROM login_attempts WHERE email_hash IN (${createdEmails.map(() => '?').join(', ')})`, createdEmails.map((value) => sha256(value)))
  } finally {
    await closePool()
  }
})

test('el motor calcula cobertura real, protege materiales privados y no reserva inventario', async () => {
  const owner = new Jar()
  const ownerEmail = email('obra')
  await register(owner, ownerEmail, 'Persona de matching')
  const organizationId = await createOrganization(owner, ownerEmail, 'Obra de matching')
  const other = new Jar()
  const otherEmail = email('otra')
  await register(other, otherEmail, 'Otra organización')
  const otherOrganizationId = await createOrganization(other, otherEmail, 'Acopio ajeno')
  const categories = await call('GET', '/api/material-categories', owner)
  const units = await call('GET', '/api/measurement-units', owner)
  const categoryList = dataOf(categories.body).categories
  const unitList = dataOf(units.body).units
  assert.ok(Array.isArray(categoryList) && Array.isArray(unitList))
  const records = categoryList.filter((item) => isRecord(item))
  const firstCategory = records.find((item) => item.name === 'Mampostería') ?? records[0]
  const secondCategory = records.find((item) => item.name === 'Metales' && item.id !== firstCategory?.id) ?? records.find((item) => item.id !== firstCategory?.id)
  const unit = unitList.find((item) => isRecord(item) && item.code === 'unit')
  const kilogram = unitList.find((item) => isRecord(item) && item.code === 'kg')
  assert.ok(isRecord(firstCategory) && isRecord(secondCategory) && isRecord(unit) && isRecord(kilogram))

  const material = await call('POST', '/api/materials', owner, {
    organizationId,
    categoryId: firstCategory.id,
    unitId: unit.id,
    title: 'Ladrillos de arcilla reutilizables',
    description: 'Lote declarado para la prueba de compatibilidad.',
    materialCondition: 'fair',
    quantity: 120,
    originType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    locationDescription: 'Patio interno, no publicar',
    availabilityStatus: 'published',
  })
  assert.equal(material.status, 201)
  const createdMaterial = dataOf(material.body).material
  assert.ok(isRecord(createdMaterial))
  const materialId = Number(createdMaterial.id)

  const hidden = await call('POST', '/api/materials', other, {
    organizationId: otherOrganizationId,
    categoryId: firstCategory.id,
    unitId: unit.id,
    title: 'Ladrillos privados ajenos',
    description: 'No deben aparecer.',
    materialCondition: 'good',
    quantity: 50,
    originType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    availabilityStatus: 'published',
  })
  assert.equal(hidden.status, 201)
  const hiddenMaterial = dataOf(hidden.body).material
  assert.ok(isRecord(hiddenMaterial))

  const wrongUnit = await call('POST', '/api/materials', owner, {
    organizationId,
    categoryId: firstCategory.id,
    unitId: kilogram.id,
    title: 'Arcilla por peso',
    description: 'Misma categoría, otra unidad.',
    materialCondition: 'fair',
    quantity: 10,
    originType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    availabilityStatus: 'published',
  })
  assert.equal(wrongUnit.status, 201)

  const otherCategory = await call('POST', '/api/materials', owner, {
    organizationId,
    categoryId: secondCategory.id,
    unitId: unit.id,
    title: 'Perfil metálico',
    description: 'Otra categoría del catálogo.',
    materialCondition: 'good',
    quantity: 4,
    originType: 'industrial',
    city: 'Cali',
    department: 'Valle del Cauca',
    availabilityStatus: 'published',
  })
  assert.equal(otherCategory.status, 201)

  const project = await call('POST', '/api/projects', owner, {
    organizationId,
    title: 'Remodelación de prueba',
    description: 'Proyecto para buscar materiales.',
    projectType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    address: 'Carrera privada 8',
    startDate: '2026-11-01',
    endDate: '2026-12-31',
    status: 'active',
    visibility: 'private',
  })
  assert.equal(project.status, 201)
  const createdProject = dataOf(project.body).project
  assert.ok(isRecord(createdProject))
  const need = await call('POST', `/api/projects/${createdProject.id}/needs`, owner, {
    title: 'Ladrillos de arcilla reutilizables',
    description: 'Mampostería no estructural.',
    categoryId: firstCategory.id,
    requiredQuantity: 650,
    unitId: unit.id,
    requiredCondition: 'fair',
    priority: 'urgent',
    neededBy: '2026-12-15',
    city: 'Cali',
    department: 'Valle del Cauca',
    specifications: [{ name: 'Uso previsto', value: 'Divisiones interiores no estructurales' }],
    status: 'open',
    visibility: 'private',
  })
  assert.equal(need.status, 201)
  const createdNeed = dataOf(need.body).need
  assert.ok(isRecord(createdNeed))
  const needId = Number(createdNeed.id)

  const stranger = await call('GET', `/api/needs/${needId}/matches`, other)
  assert.equal(stranger.status, 404)

  const calculated = await call('POST', `/api/needs/${needId}/matches/recalculate`, owner)
  assert.equal(calculated.status, 200, JSON.stringify(calculated.body.error ?? calculated.body))
  const data = dataOf(calculated.body)
  assert.equal(data.persisted, true)
  console.info(`duración real del recálculo: ${data.durationMs} ms`)
  assert.ok(Number(data.durationMs) < 2000, `duración real ${data.durationMs} ms`)
  const matches = data.matches
  assert.ok(Array.isArray(matches))
  const brick = matches.find((item) => isRecord(item) && item.materialId === materialId)
  assert.ok(isRecord(brick))
  assert.equal(brick.coveragePercent, 18.46)
  assert.equal(brick.deficitQuantity, 530)
  assert.equal(brick.usableQuantity, 120)
  assert.equal(brick.geographyLevel, 'same_municipality')
  assert.equal(brick.technicalState, 'unknown')
  assert.equal(brick.classification, 'insufficient')
  assert.match(String(brick.explanation), /18,46/)
  assert.match(String(brick.explanation), /no reserva/i)
  assert.equal(String(brick.explanation).includes('Patio interno'), false)
  assert.equal(matches.some((item) => isRecord(item) && item.title === 'Ladrillos privados ajenos'), false)
  const excluded = data.excluded
  assert.ok(Array.isArray(excluded))
  assert.ok(excluded.some((item) => isRecord(item) && item.exclusionCode === 'INCOMPATIBLE_UNIT'))
  assert.ok(excluded.some((item) => isRecord(item) && item.exclusionCode === 'INCOMPATIBLE_CATEGORY'))

  const { getPool } = await import('../../config/database.js')
  const pool = getPool()
  const [quantities] = await pool.query<RowDataPacket[]>('SELECT quantity FROM materials WHERE id = ?', [materialId])
  assert.equal(Number(quantities[0]?.quantity), 120)
  const [requests] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM material_requests WHERE material_id = ?', [materialId])
  assert.equal(Number(requests[0]?.total), 0)

  const storedId = Number(brick.storedMatchId)
  assert.ok(storedId > 0)
  const edited = await call('PATCH', `/api/materials/${materialId}`, owner, { quantity: 800 })
  assert.equal(edited.status, 200)
  const stale = await call('GET', `/api/matches/${storedId}`, owner)
  assert.equal(stale.status, 409)
  assert.equal(isRecord(stale.body.error) ? stale.body.error.code : '', 'STALE_MATCH')
  const refreshed = await call('POST', `/api/needs/${needId}/matches/recalculate?sort=coverage`, owner)
  const refreshedBrick = (dataOf(refreshed.body).matches as unknown[]).find((item) => isRecord(item) && item.materialId === materialId)
  assert.ok(isRecord(refreshedBrick))
  assert.equal(refreshedBrick.coveragePercent, 100)
  assert.equal(refreshedBrick.deficitQuantity, 0)

  const passport = await call('GET', `/api/materials/${hiddenMaterial.id}/passport`, other)
  const passportRecord = dataOf(passport.body).passport
  assert.ok(isRecord(passportRecord))
  const published = await call('PATCH', `/api/passports/${passportRecord.publicCode}/visibility`, other, { visibility: 'public' })
  assert.equal(published.status, 200)
  const shared = await call('GET', `/api/needs/${needId}/matches`, owner)
  const sharedMatches = dataOf(shared.body).matches
  assert.ok(Array.isArray(sharedMatches))
  const foreign = sharedMatches.find((item) => isRecord(item) && item.title === 'Ladrillos privados ajenos')
  assert.ok(isRecord(foreign))
  assert.equal(foreign.inventoryPath, null)
  assert.match(String(foreign.passportPath), /^\/pasaporte\/rob_/)

  const viewer = new Jar()
  const viewerId = await register(viewer, email('consulta'), 'Consulta de matching')
  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role, membership_status) VALUES (?, ?, 'viewer', 'active')`,
    [organizationId, viewerId],
  )
  const viewerWrite = await call('POST', `/api/needs/${needId}/matches/recalculate`, viewer)
  assert.equal(viewerWrite.status, 403)
  const viewerRead = await call('GET', `/api/needs/${needId}/matches`, viewer)
  assert.equal(viewerRead.status, 200)

  const closed = await call('POST', `/api/needs/${needId}/cancel`, owner, {})
  assert.equal(closed.status, 200)
  const blocked = await call('GET', `/api/needs/${needId}/matches`, owner)
  assert.equal(blocked.status, 409)
})
