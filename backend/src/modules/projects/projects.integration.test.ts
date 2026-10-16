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
  const value = `fase7-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@reobra.test`
  createdEmails.push(value)
  return value
}

async function call(
  method: string,
  path: string,
  jar: Jar,
  body?: unknown,
  csrf = true,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = new Headers({ Accept: 'application/json' })
  const cookie = jar.header()
  if (cookie) {
    headers.set('cookie', cookie)
  }
  if (body !== undefined) {
    headers.set('content-type', 'application/json')
  }
  if (csrf && method !== 'GET' && method !== 'HEAD') {
    headers.set('x-csrf-token', jar.csrf())
  }
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value)
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

async function register(jar: Jar, address: string): Promise<number> {
  const result = await call('POST', '/api/auth/register', jar, {
    fullName: 'Persona de proyectos',
    email: address,
    password,
    acceptedTerms: true,
  })
  assert.equal(result.status, 201)
  const me = await call('GET', '/api/auth/me', jar)
  const user = dataOf(me.body).user
  assert.ok(isRecord(user))
  return Number(user.id)
}

async function createOrganization(jar: Jar, address: string): Promise<number> {
  const result = await call('POST', '/api/organizations', jar, {
    name: 'Obra de prueba',
    organizationType: 'company',
    contactEmail: address,
    city: 'Medellín',
    department: 'Antioquia',
    country: 'CO',
  })
  assert.equal(result.status, 201)
  const organization = dataOf(result.body).organization
  assert.ok(isRecord(organization))
  return Number(organization.id)
}

async function catalog(jar: Jar): Promise<{ categoryId: number; kilogramId: number; meterId: number }> {
  const categories = await call('GET', '/api/material-categories', jar)
  const units = await call('GET', '/api/measurement-units', jar)
  const categoryList = dataOf(categories.body).categories
  const unitList = dataOf(units.body).units
  assert.ok(Array.isArray(categoryList) && Array.isArray(unitList))
  const category = categoryList.find((item) => isRecord(item))
  const kilogram = unitList.find((item) => isRecord(item) && item.code === 'kg')
  const meter = unitList.find((item) => isRecord(item) && item.code === 'm')
  assert.ok(isRecord(category) && isRecord(kilogram) && isRecord(meter))
  return { categoryId: Number(category.id), kilogramId: Number(kilogram.id), meterId: Number(meter.id) }
}

before(async () => {
  await import('../../config/env.js')
  const { readDatabaseConfig, closePool } = await import('../../config/database.js')
  if (readDatabaseConfig().database !== 'reobra') {
    throw new Error('Las pruebas de proyectos usan la base reobra y solo borran correos fase7-…@reobra.test.')
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
  if (!ready || createdEmails.length === 0) {
    if (ready) {
      const { closePool } = await import('../../config/database.js')
      await closePool()
    }
    return
  }
  const { getPool, closePool } = await import('../../config/database.js')
  const { sha256 } = await import('../auth/tokens.js')
  const pool = getPool()
  const [databaseRows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name')
  if (databaseRows[0]?.name !== 'reobra') {
    throw new Error('Se evitó limpiar una base distinta de reobra.')
  }
  const placeholders = createdEmails.map(() => '?').join(', ')
  const [orgRows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM organizations WHERE contact_email IN (${placeholders})`,
    createdEmails,
  )
  const orgIds = orgRows.map((row) => Number(row.id))
  if (orgIds.length > 0) {
    const ids = orgIds.map(() => '?').join(', ')
    const [projectRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM projects WHERE organization_id IN (${ids})`,
      orgIds,
    )
    const [materialRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM materials WHERE organization_id IN (${ids})`,
      orgIds,
    )
    const materialIds = materialRows.map((row) => Number(row.id))
    if (materialIds.length > 0) {
      const materialPlaceholders = materialIds.map(() => '?').join(', ')
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
    const projectIds = projectRows.map((row) => Number(row.id))
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
    await pool.query(
      `DELETE FROM organizations WHERE id IN (${ids}) AND id NOT IN (SELECT organization_id FROM organization_members)`,
      orgIds,
    )
  }
  await pool.query(`DELETE FROM users WHERE email IN (${placeholders})`, createdEmails)
  await pool.query(
    `DELETE FROM login_attempts WHERE email_hash IN (${createdEmails.map(() => '?').join(', ')})`,
    createdEmails.map((value) => sha256(value)),
  )
  await closePool()
})

function projectBody(organizationId: number, title: string, status: 'draft' | 'active' = 'active') {
  return {
    organizationId,
    title,
    description: 'Remodelación declarada por la organización.',
    projectType: 'construction',
    city: 'Medellín',
    department: 'Antioquia',
    address: 'Calle interna 12, no publicar',
    startDate: '2026-11-01',
    endDate: '2026-12-20',
    status,
    visibility: 'private',
  }
}

test('un proyecto y sus necesidades persisten, se editan y no tocan el inventario', async () => {
  const owner = new Jar()
  const ownerEmail = email('obra')
  await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail)
  const { categoryId, kilogramId, meterId } = await catalog(owner)
  const key = 'fase7-idem-proyecto'
  const first = await call('POST', '/api/projects', owner, projectBody(organizationId, 'Remodelación sostenible'), true, {
    'idempotency-key': key,
  })
  assert.equal(first.status, 201)
  const created = dataOf(first.body).project
  assert.ok(isRecord(created))
  const projectId = Number(created.id)
  assert.match(String(created.publicCode), /^prj_[a-z0-9]{20}$/)
  assert.equal(created.address, 'Calle interna 12, no publicar')
  const replay = await call('POST', '/api/projects', owner, projectBody(organizationId, 'No debe duplicarse'), true, {
    'idempotency-key': key,
  })
  assert.equal(Number((dataOf(replay.body).project as Record<string, unknown>).id), projectId)

  const renamed = await call('PATCH', `/api/projects/${projectId}`, owner, { title: 'Remodelación corregida' })
  assert.equal(renamed.status, 200)
  assert.equal((dataOf(renamed.body).project as Record<string, unknown>).title, 'Remodelación corregida')

  const badDates = await call('PATCH', `/api/projects/${projectId}`, owner, { startDate: '2026-12-20', endDate: '2026-11-01' })
  assert.equal(badDates.status, 400)

  const material = await call('POST', '/api/materials', owner, {
    organizationId,
    categoryId,
    unitId: kilogramId,
    title: 'Ladrillo de control',
    quantity: '10',
    originType: 'construction',
    city: 'Medellín',
    department: 'Antioquia',
    availabilityStatus: 'published',
  })
  assert.equal(material.status, 201)
  const materialId = Number((dataOf(material.body).material as Record<string, unknown>).id)
  const quantityBefore = String((dataOf(material.body).material as Record<string, unknown>).quantity)

  const need = await call('POST', `/api/projects/${projectId}/needs`, owner, {
    categoryId,
    unitId: kilogramId,
    title: 'Ladrillos reutilizables',
    description: 'Piezas recuperadas para muros divisorios.',
    requiredQuantity: '500',
    priority: 'high',
    neededBy: '2026-12-15',
    requiredCondition: 'good',
    specifications: [{ name: 'aparejo', value: 'a soga o tizón' }],
    status: 'open',
  })
  assert.equal(need.status, 201)
  const needRecord = dataOf(need.body).need
  assert.ok(isRecord(needRecord))
  const needId = Number(needRecord.id)
  assert.equal(needRecord.status, 'open')
  assert.equal(needRecord.requiredQuantity, '500.000')

  const badQuantity = await call('PATCH', `/api/needs/${needId}`, owner, { requiredQuantity: '0' })
  assert.equal(badQuantity.status, 400)
  const incompatible = await call('PATCH', `/api/needs/${needId}`, owner, { unitId: meterId })
  assert.equal(incompatible.status, 409)
  const edited = await call('PATCH', `/api/needs/${needId}`, owner, { requiredQuantity: '480' })
  assert.equal(edited.status, 200)
  assert.equal((dataOf(edited.body).need as Record<string, unknown>).requiredQuantity, '480.000')

  const forged = await call('PATCH', `/api/needs/${needId}`, owner, { status: 'satisfied' })
  assert.equal(forged.status, 400)
  const closed = await call('POST', `/api/needs/${needId}/close`, owner, {})
  assert.equal(closed.status, 200)
  assert.equal((dataOf(closed.body).need as Record<string, unknown>).status, 'satisfied')
  const detail = await call('GET', `/api/projects/${projectId}`, owner)
  const events = dataOf(detail.body).events
  assert.ok(Array.isArray(events))
  const closedEvent = events.find((event) => isRecord(event) && event.eventType === 'need_closed')
  assert.ok(isRecord(closedEvent))
  assert.equal(String(closedEvent.description).toLowerCase().includes('entrega'), true)
  assert.equal(String(closedEvent.description).toLowerCase().includes('descuenta'), true)
  const materialAfter = await call('GET', `/api/materials/${materialId}`, owner)
  assert.equal(String((dataOf(materialAfter.body).material as Record<string, unknown>).quantity), quantityBefore)

  const listed = await call('GET', '/api/projects?q=corregida&pageSize=5', owner)
  const page = dataOf(listed.body)
  assert.equal(Array.isArray(page.projects), true)
  assert.equal((page.projects as unknown[]).length >= 1, true)
  const summary = page.summary
  assert.ok(isRecord(summary))
  assert.equal(Number(summary.total) >= 1, true)
})

test('los proyectos privados quedan aislados y el archivo bloquea la edición', async () => {
  const owner = new Jar()
  const ownerEmail = email('aislada')
  await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail)
  const created = await call('POST', '/api/projects', owner, projectBody(organizationId, 'Colegio visible', 'active'))
  const project = dataOf(created.body).project
  assert.ok(isRecord(project))
  const projectId = Number(project.id)
  const publicCode = String(project.publicCode)

  const stranger = new Jar()
  await register(stranger, email('ajena'))
  const hidden = await call('PATCH', `/api/projects/${projectId}`, stranger, { title: 'Intento ajeno' })
  assert.equal(hidden.status, 404)
  const anonymous = await call('GET', `/api/projects/public/${publicCode}`, new Jar(), undefined, false)
  assert.equal(anonymous.status, 404)

  const viewer = new Jar()
  const viewerId = await register(viewer, email('consulta'))
  const { getPool } = await import('../../config/database.js')
  await getPool().query(
    `INSERT INTO organization_members (organization_id, user_id, role, membership_status) VALUES (?, ?, 'viewer', 'active')`,
    [organizationId, viewerId],
  )
  const forbidden = await call('PATCH', `/api/projects/${projectId}`, viewer, { title: 'Intento de consulta' })
  assert.equal(forbidden.status, 403)

  const published = await call('PATCH', `/api/projects/${projectId}`, owner, { visibility: 'public' })
  assert.equal(published.status, 200)
  const anon = await call('GET', `/api/projects/public/${publicCode}`, new Jar(), undefined, false)
  assert.equal(anon.status, 200)
  const publicProject = dataOf(anon.body).project
  assert.ok(isRecord(publicProject))
  assert.equal(publicProject.address, null)
  assert.equal('organizationId' in publicProject, false)
  assert.equal(JSON.stringify(publicProject).includes(ownerEmail), false)

  const archived = await call('POST', `/api/projects/${projectId}/archive`, owner, {})
  assert.equal(archived.status, 200)
  assert.equal((dataOf(archived.body).project as Record<string, unknown>).status, 'archived')
  const locked = await call('PATCH', `/api/projects/${projectId}`, owner, { title: 'No debe cambiar' })
  assert.equal(locked.status, 409)
  const afterArchive = await call('GET', `/api/projects/public/${publicCode}`, new Jar(), undefined, false)
  assert.equal(afterArchive.status, 404)
  const restored = await call('POST', `/api/projects/${projectId}/status`, owner, { status: 'draft' })
  assert.equal(restored.status, 200)
  assert.equal((dataOf(restored.body).project as Record<string, unknown>).status, 'draft')
  assert.equal((dataOf(restored.body).project as Record<string, unknown>).title, 'Colegio visible')
})
