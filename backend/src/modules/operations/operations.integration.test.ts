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
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
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
  const value = `fase9-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@reobra.test`
  createdEmails.push(value)
  return value
}

async function call(method: string, path: string, jar: Jar, body?: unknown, idempotencyKey?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers = new Headers({ Accept: 'application/json' })
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') headers.set('x-csrf-token', jar.csrf())
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey)
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
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

function errorCode(body: Record<string, unknown>): string {
  return isRecord(body.error) ? String(body.error.code) : ''
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
  if (readDatabaseConfig().database !== 'reobra') throw new Error('Las pruebas de operaciones usan la base reobra.')
  const { migrateUp } = await import('../../database/migrator.js')
  await migrateUp()
  await closePool()
  const { createApp } = await import('../../app.js')
  const { getConfig } = await import('../../config/env.js')
  const app: Express = createApp(getConfig())
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No se pudo abrir el servidor de prueba.')
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`
  ready = true
})

after(async () => {
  if (server) {
    server.closeAllConnections()
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  }
  const { getPool, closePool } = await import('../../config/database.js')
  try {
    if (!ready || createdEmails.length === 0) return
    const { sha256 } = await import('../auth/tokens.js')
    const pool = getPool()
    const placeholders = createdEmails.map(() => '?').join(', ')
    const [orgRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM organizations WHERE contact_email IN (${placeholders})`, createdEmails)
    const orgIds = orgRows.map((row) => Number(row.id))
    if (orgIds.length > 0) {
      const ids = orgIds.map(() => '?').join(', ')
      const [projectRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM projects WHERE organization_id IN (${ids})`, orgIds)
      const projectIds = projectRows.map((row) => Number(row.id))
      const [materialRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM materials WHERE organization_id IN (${ids})`, orgIds)
      const materialIds = materialRows.map((row) => Number(row.id))
      let requestIds: number[] = []
      if (materialIds.length > 0 || orgIds.length > 0) {
        const [requestRows] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM material_requests WHERE requesting_organization_id IN (${ids}) ${materialIds.length > 0 ? `OR material_id IN (${materialIds.map(() => '?').join(', ')})` : ''}`,
          materialIds.length > 0 ? [...orgIds, ...materialIds] : orgIds,
        )
        requestIds = requestRows.map((row) => Number(row.id))
      }
      if (requestIds.length > 0) {
        const requestPlaceholders = requestIds.map(() => '?').join(', ')
        const [documentRows] = await pool.query<RowDataPacket[]>(`SELECT storage_key FROM operation_documents WHERE request_id IN (${requestPlaceholders})`, requestIds)
        const { removeDocumentFile } = await import('../passports/document-storage.js')
        for (const document of documentRows) {
          if (typeof document.storage_key === 'string') {
            await removeDocumentFile(document.storage_key)
          }
        }
        await pool.query(`DELETE FROM operation_documents WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM logistics_incidents WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM operation_notifications WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM request_events WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM request_operations WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM request_proposals WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM deliveries WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM material_requests WHERE id IN (${requestPlaceholders})`, requestIds)
      }
      if (projectIds.length > 0) {
        const projectPlaceholders = projectIds.map(() => '?').join(', ')
        await pool.query(`DELETE FROM project_events WHERE project_id IN (${projectPlaceholders})`, projectIds)
        await pool.query(`DELETE FROM project_material_needs WHERE project_id IN (${projectPlaceholders})`, projectIds)
        await pool.query(`DELETE FROM projects WHERE id IN (${projectPlaceholders})`, projectIds)
      }
      if (materialIds.length > 0) {
        const materialPlaceholders = materialIds.map(() => '?').join(', ')
        await pool.query(`DELETE FROM material_matches WHERE material_id IN (${materialPlaceholders})`, materialIds)
        await pool.query(`DELETE FROM material_trace_events WHERE material_id IN (${materialPlaceholders})`, materialIds)
        await pool.query(
          `DELETE revision FROM material_passport_revisions revision
           INNER JOIN material_passports passport ON passport.id = revision.passport_id
           WHERE passport.material_id IN (${materialPlaceholders})`,
          materialIds,
        )
        await pool.query(`DELETE FROM material_passports WHERE material_id IN (${materialPlaceholders})`, materialIds)
        await pool.query(`DELETE FROM materials WHERE id IN (${materialPlaceholders})`, materialIds)
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

async function catalog(jar: Jar): Promise<{ categoryId: number; unitId: number }> {
  const categories = await call('GET', '/api/material-categories', jar)
  const units = await call('GET', '/api/measurement-units', jar)
  const categoryList = dataOf(categories.body).categories
  const unitList = dataOf(units.body).units
  assert.ok(Array.isArray(categoryList) && Array.isArray(unitList))
  const category = categoryList.find((item) => isRecord(item) && item.name === 'Mampostería')
  const unit = unitList.find((item) => isRecord(item) && item.code === 'unit')
  assert.ok(isRecord(category) && isRecord(unit))
  return { categoryId: Number(category.id), unitId: Number(unit.id) }
}

test('una solicitud de 80 unidades reserva, sale y se recibe sin descontar dos veces', async () => {
  const supplierJar = new Jar()
  const supplierEmail = email('oferente')
  await register(supplierJar, supplierEmail, 'Oferente de operaciones')
  const supplierOrg = await createOrganization(supplierJar, supplierEmail, 'Acopio de operaciones')
  const buyerJar = new Jar()
  const buyerEmail = email('solicitante')
  const buyerId = await register(buyerJar, buyerEmail, 'Solicitante de operaciones')
  const buyerOrg = await createOrganization(buyerJar, buyerEmail, 'Obra de operaciones')
  const { categoryId, unitId } = await catalog(supplierJar)
  const material = await call('POST', '/api/materials', supplierJar, {
    organizationId: supplierOrg,
    categoryId,
    unitId,
    title: 'Ladrillos reutilizables de prueba',
    description: 'Lote de prueba de la fase 9.',
    materialCondition: 'fair',
    quantity: 120,
    originType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    availabilityStatus: 'published',
  })
  assert.equal(material.status, 201)
  const createdMaterial = dataOf(material.body).material
  assert.ok(isRecord(createdMaterial))
  const materialId = Number(createdMaterial.id)
  const hidden = await call('POST', '/api/materials', supplierJar, {
    organizationId: supplierOrg,
    categoryId,
    unitId,
    title: 'Lote privado de operaciones',
    description: 'No debe poder solicitarse.',
    materialCondition: 'fair',
    quantity: 10,
    originType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    availabilityStatus: 'published',
  })
  assert.equal(hidden.status, 201)
  const hiddenMaterial = dataOf(hidden.body).material
  assert.ok(isRecord(hiddenMaterial))
  const passport = await call('GET', `/api/materials/${materialId}/passport`, supplierJar)
  const passportRecord = dataOf(passport.body).passport
  assert.ok(isRecord(passportRecord))
  const published = await call('PATCH', `/api/passports/${passportRecord.publicCode}/visibility`, supplierJar, { visibility: 'public' })
  assert.equal(published.status, 200)

  const project = await call('POST', '/api/projects', buyerJar, {
    organizationId: buyerOrg,
    title: 'Remodelación de prueba fase 9',
    description: 'Proyecto de prueba.',
    projectType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    address: 'Carrera de prueba',
    startDate: '2026-11-01',
    endDate: '2026-12-31',
    status: 'active',
  })
  const createdProject = dataOf(project.body).project
  assert.ok(isRecord(createdProject))
  const need = await call('POST', `/api/projects/${createdProject.id}/needs`, buyerJar, {
    title: 'Ladrillos reutilizables',
    description: 'Necesidad de prueba.',
    categoryId,
    requiredQuantity: 650,
    unitId,
    priority: 'urgent',
    neededBy: '2026-12-15',
    status: 'open',
  })
  const createdNeed = dataOf(need.body).need
  assert.ok(isRecord(createdNeed))
  const needId = Number(createdNeed.id)

  const invalid = await call('POST', '/api/material-requests', buyerJar, { materialId, needId, quantity: 0 }, 'fase9-cantidad-invalida')
  assert.equal(invalid.status, 400)
  const secret = await call('POST', '/api/material-requests', buyerJar, { materialId: Number(hiddenMaterial.id), needId, quantity: 1 }, 'fase9-material-privado')
  assert.equal(secret.status, 404)

  const key = 'fase9-solicitud-ochenta'
  const first = await call('POST', '/api/material-requests', buyerJar, { materialId, needId, quantity: 80, message: 'Solicito 80 unidades.' }, key)
  assert.equal(first.status, 201, JSON.stringify(first.body.error ?? first.body))
  const again = await call('POST', '/api/material-requests', buyerJar, { materialId, needId, quantity: 80, message: 'Solicito 80 unidades.' }, key)
  assert.equal(again.status, 201)
  const request = dataOf(first.body).request
  const repeated = dataOf(again.body).request
  assert.ok(isRecord(request) && isRecord(repeated))
  assert.equal(request.id, repeated.id)
  assert.equal(request.status, 'submitted')
  const requestId = Number(request.id)

  const stranger = new Jar()
  await register(stranger, email('ajena'), 'Ajena de operaciones')
  await createOrganization(stranger, createdEmails[createdEmails.length - 1] ?? '', 'Ajena operaciones')
  const hiddenRequest = await call('GET', `/api/material-requests/${requestId}`, stranger)
  assert.equal(hiddenRequest.status, 404)

  const reviewed = await call('POST', `/api/material-requests/${requestId}/review`, supplierJar, {}, 'fase9-revision')
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body.error ?? reviewed.body))
  const accepted = await call('POST', `/api/material-requests/${requestId}/accept`, supplierJar, {}, 'fase9-aceptar')
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body.error ?? accepted.body))
  const reserved = dataOf(accepted.body).request
  assert.ok(isRecord(reserved))
  assert.equal(reserved.status, 'accepted')
  const repeatedAccept = await call('POST', `/api/material-requests/${requestId}/accept`, supplierJar, {}, 'fase9-aceptar')
  assert.equal(repeatedAccept.status, 200)

  const { getPool } = await import('../../config/database.js')
  const pool = getPool()
  const [stock] = await pool.query<RowDataPacket[]>('SELECT quantity FROM materials WHERE id = ?', [materialId])
  assert.equal(Number(stock[0]?.quantity), 120)
  const [summary] = await pool.query<RowDataPacket[]>('SELECT available_quantity, committed_quantity, delivered_quantity FROM material_quantity_summary WHERE material_id = ?', [materialId])
  assert.equal(Number(summary[0]?.available_quantity), 40)
  assert.equal(Number(summary[0]?.committed_quantity), 80)
  assert.equal(Number(summary[0]?.delivered_quantity), 0)

  const tooMuch = await call('POST', '/api/material-requests', buyerJar, { materialId, needId, quantity: 80 }, 'fase9-exceso')
  assert.equal(tooMuch.status, 201)
  const excess = dataOf(tooMuch.body).request
  assert.ok(isRecord(excess))
  const excessAccept = await call('POST', `/api/material-requests/${excess.id}/accept`, supplierJar, {}, 'fase9-exceso-aceptar')
  assert.equal(excessAccept.status, 409)
  assert.equal(errorCode(excessAccept.body), 'INSUFFICIENT_STOCK')

  const over = await call('POST', `/api/material-requests/${requestId}/dispatch`, supplierJar, { quantity: 90, occurredAt: new Date().toISOString() }, 'fase9-despacho-exceso')
  assert.equal(over.status, 409)
  const buyerDispatch = await call('POST', `/api/material-requests/${requestId}/dispatch`, buyerJar, { quantity: 50, occurredAt: new Date().toISOString() }, 'fase9-despacho-ajeno')
  assert.equal(buyerDispatch.status, 403)
  const dispatched = await call('POST', `/api/material-requests/${requestId}/dispatch`, supplierJar, { quantity: 50, occurredAt: new Date().toISOString(), notes: 'Primera salida.' }, 'fase9-despacho-50')
  assert.equal(dispatched.status, 200, JSON.stringify(dispatched.body.error ?? dispatched.body))
  const replayDispatch = await call('POST', `/api/material-requests/${requestId}/dispatch`, supplierJar, { quantity: 50, occurredAt: new Date().toISOString() }, 'fase9-despacho-50')
  assert.equal(replayDispatch.status, 200)
  const [afterPartial] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM deliveries WHERE request_id = ?', [requestId])
  assert.equal(Number(afterPartial[0]?.total), 1)
  const second = await call('POST', `/api/material-requests/${requestId}/dispatch`, supplierJar, { quantity: 30, occurredAt: new Date().toISOString() }, 'fase9-despacho-30')
  assert.equal(second.status, 200, JSON.stringify(second.body.error ?? second.body))
  const finished = dataOf(second.body)
  const deliveries = finished.deliveries
  assert.ok(Array.isArray(deliveries) && deliveries.length === 2)
  const firstDelivery = deliveries[0]
  const secondDelivery = deliveries[1]
  assert.ok(isRecord(firstDelivery) && isRecord(secondDelivery))
  const tooReceived = await call('POST', `/api/material-requests/${requestId}/deliveries/${firstDelivery.id}/receive`, buyerJar, { quantity: 60, occurredAt: new Date().toISOString(), condition: 'fair' }, 'fase9-recepcion-exceso')
  assert.equal(tooReceived.status, 409)
  const supplierReceive = await call('POST', `/api/material-requests/${requestId}/deliveries/${firstDelivery.id}/receive`, supplierJar, { quantity: 50, occurredAt: new Date().toISOString(), condition: 'fair' }, 'fase9-recepcion-ajena')
  assert.equal(supplierReceive.status, 403)
  const received = await call('POST', `/api/material-requests/${requestId}/deliveries/${firstDelivery.id}/receive`, buyerJar, { quantity: 50, occurredAt: new Date().toISOString(), condition: 'fair' }, 'fase9-recepcion-50')
  assert.equal(received.status, 200, JSON.stringify(received.body.error ?? received.body))
  const receivedAgain = await call('POST', `/api/material-requests/${requestId}/deliveries/${firstDelivery.id}/receive`, buyerJar, { quantity: 50, occurredAt: new Date().toISOString(), condition: 'fair' }, 'fase9-recepcion-50')
  assert.equal(receivedAgain.status, 200)
  const rest = await call('POST', `/api/material-requests/${requestId}/deliveries/${secondDelivery.id}/receive`, buyerJar, { quantity: 30, occurredAt: new Date().toISOString(), condition: 'good' }, 'fase9-recepcion-30')
  assert.equal(rest.status, 200, JSON.stringify(rest.body.error ?? rest.body))
  const closed = dataOf(rest.body).request
  assert.ok(isRecord(closed))
  assert.equal(closed.receivedCoveragePercent, 12.31)
  const [finalStock] = await pool.query<RowDataPacket[]>('SELECT quantity FROM materials WHERE id = ?', [materialId])
  assert.equal(Number(finalStock[0]?.quantity), 120)
  const [finalSummary] = await pool.query<RowDataPacket[]>('SELECT available_quantity, delivered_quantity, committed_quantity FROM material_quantity_summary WHERE material_id = ?', [materialId])
  assert.equal(Number(finalSummary[0]?.delivered_quantity), 80)
  assert.equal(Number(finalSummary[0]?.committed_quantity), 0)
  assert.equal(Number(finalSummary[0]?.available_quantity), 40)
  const [events] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM material_trace_events WHERE material_id = ? AND event_type IN (\'request_created\', \'delivery_recorded\', \'availability_changed\')', [materialId])
  assert.ok(Number(events[0]?.total) >= 3)
  const cancelLate = await call('POST', `/api/material-requests/${requestId}/cancel`, buyerJar, {}, 'fase9-cancelar-tarde')
  assert.equal(cancelLate.status, 409)

  const incident = await call('POST', `/api/material-requests/${requestId}/incidents`, buyerJar, { type: 'delay', description: 'La segunda salida llegó más tarde de lo conversado.' }, 'fase9-incidencia')
  assert.equal(incident.status, 200, JSON.stringify(incident.body.error ?? incident.body))
  const opened = dataOf(incident.body).incidents
  assert.ok(Array.isArray(opened) && isRecord(opened[0]))
  const emptyResolution = await call('POST', `/api/material-requests/${requestId}/incidents/${opened[0].id}/resolve`, supplierJar, { resolution: '   ' }, 'fase9-resolucion-vacia')
  assert.equal(emptyResolution.status, 400)
  const resolved = await call('POST', `/api/material-requests/${requestId}/incidents/${opened[0].id}/resolve`, supplierJar, { resolution: 'Se dejó constancia del retraso.' }, 'fase9-resolucion')
  assert.equal(resolved.status, 200)

  const logistics = await call('POST', `/api/material-requests/${requestId}/logistics`, supplierJar, { mode: 'pickup_by_requester', originCity: 'Cali', originDepartment: 'Valle del Cauca', status: 'scheduled', pickupPlace: 'Portería autorizada' }, 'fase9-logistica')
  assert.equal(logistics.status, 409)

  const viewer = new Jar()
  const viewerId = await register(viewer, email('consulta'), 'Consulta de operaciones')
  await pool.query(`INSERT INTO organization_members (organization_id, user_id, role, membership_status) VALUES (?, ?, 'viewer', 'active')`, [buyerOrg, viewerId])
  const viewerWrite = await call('POST', '/api/material-requests', viewer, { materialId, needId, quantity: 1 }, 'fase9-consulta-crear')
  assert.equal(viewerWrite.status, 403)
  assert.ok(buyerId > 0)
})

test('dos reservas simultáneas no superan la existencia', async () => {
  const supplierJar = new Jar()
  const supplierEmail = email('carrera')
  await register(supplierJar, supplierEmail, 'Oferente concurrente')
  const supplierOrg = await createOrganization(supplierJar, supplierEmail, 'Acopio concurrente')
  const buyerJar = new Jar()
  const buyerEmail = email('carrera-obra')
  await register(buyerJar, buyerEmail, 'Obra concurrente')
  const buyerOrg = await createOrganization(buyerJar, buyerEmail, 'Obra concurrente')
  const { categoryId, unitId } = await catalog(supplierJar)
  const material = await call('POST', '/api/materials', supplierJar, {
    organizationId: supplierOrg,
    categoryId,
    unitId,
    title: 'Ladrillos para concurrencia',
    description: 'Stock de 100 para dos reservas de 80.',
    materialCondition: 'fair',
    quantity: 100,
    originType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    availabilityStatus: 'published',
  })
  const createdMaterial = dataOf(material.body).material
  assert.ok(isRecord(createdMaterial))
  const passport = await call('GET', `/api/materials/${createdMaterial.id}/passport`, supplierJar)
  const passportRecord = dataOf(passport.body).passport
  assert.ok(isRecord(passportRecord))
  assert.equal((await call('PATCH', `/api/passports/${passportRecord.publicCode}/visibility`, supplierJar, { visibility: 'public' })).status, 200)
  const project = await call('POST', '/api/projects', buyerJar, {
    organizationId: buyerOrg,
    title: 'Obra concurrente',
    description: 'Prueba de reservas simultáneas.',
    projectType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    address: 'Calle de prueba',
    startDate: '2026-11-01',
    endDate: '2026-12-31',
    status: 'active',
  })
  const createdProject = dataOf(project.body).project
  assert.ok(isRecord(createdProject))
  const need = await call('POST', `/api/projects/${createdProject.id}/needs`, buyerJar, {
    title: 'Necesidad concurrente',
    description: 'Cantidad amplia.',
    categoryId,
    requiredQuantity: 200,
    unitId,
    status: 'open',
  })
  const createdNeed = dataOf(need.body).need
  assert.ok(isRecord(createdNeed))
  const first = await call('POST', '/api/material-requests', buyerJar, { materialId: createdMaterial.id, needId: createdNeed.id, quantity: 80 }, 'fase9-carrera-a')
  const second = await call('POST', '/api/material-requests', buyerJar, { materialId: createdMaterial.id, needId: createdNeed.id, quantity: 80 }, 'fase9-carrera-b')
  assert.equal(first.status, 201, JSON.stringify(first.body.error ?? first.body))
  assert.equal(second.status, 201, JSON.stringify(second.body.error ?? second.body))
  const left = dataOf(first.body).request
  const right = dataOf(second.body).request
  assert.ok(isRecord(left) && isRecord(right))
  const [one, two] = await Promise.all([
    call('POST', `/api/material-requests/${left.id}/accept`, supplierJar, {}, 'fase9-carrera-aceptar-a'),
    call('POST', `/api/material-requests/${right.id}/accept`, supplierJar, {}, 'fase9-carrera-aceptar-b'),
  ])
  const statuses = [one.status, two.status].sort()
  assert.deepEqual(statuses, [200, 409])
  const { getPool } = await import('../../config/database.js')
  const [summary] = await getPool().query<RowDataPacket[]>('SELECT available_quantity, committed_quantity FROM material_quantity_summary WHERE material_id = ?', [createdMaterial.id])
  assert.equal(Number(summary[0]?.committed_quantity), 80)
  assert.equal(Number(summary[0]?.available_quantity), 20)
  const winner = one.status === 200 ? left : right
  const released = await call('POST', `/api/material-requests/${winner.id}/cancel`, supplierJar, {}, 'fase9-liberar')
  assert.equal(released.status, 200, JSON.stringify(released.body.error ?? released.body))
  const releasedAgain = await call('POST', `/api/material-requests/${winner.id}/cancel`, supplierJar, {}, 'fase9-liberar')
  assert.equal(releasedAgain.status, 200)
  const [after] = await getPool().query<RowDataPacket[]>('SELECT available_quantity, committed_quantity, quantity FROM material_quantity_summary qs INNER JOIN materials m ON m.id = qs.material_id WHERE qs.material_id = ?', [createdMaterial.id])
  assert.equal(Number(after[0]?.committed_quantity), 0)
  assert.equal(Number(after[0]?.available_quantity), 100)
  assert.equal(Number(after[0]?.quantity), 100)
})

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('una contraoferta, un rechazo y un archivo no alteran la existencia', async () => {
  const supplierJar = new Jar()
  const supplierEmail = email('contra')
  await register(supplierJar, supplierEmail, 'Oferente de contraoferta')
  const supplierOrg = await createOrganization(supplierJar, supplierEmail, 'Acopio de contraoferta')
  const buyerJar = new Jar()
  const buyerEmail = email('contra-obra')
  await register(buyerJar, buyerEmail, 'Obra de contraoferta')
  const buyerOrg = await createOrganization(buyerJar, buyerEmail, 'Obra de contraoferta')
  const { categoryId, unitId } = await catalog(supplierJar)
  const material = await call('POST', '/api/materials', supplierJar, {
    organizationId: supplierOrg,
    categoryId,
    unitId,
    title: 'Ladrillos de contraoferta',
    description: 'Material de prueba para negociación.',
    materialCondition: 'fair',
    quantity: 100,
    originType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    availabilityStatus: 'published',
  })
  const createdMaterial = dataOf(material.body).material
  assert.ok(isRecord(createdMaterial))
  const materialId = Number(createdMaterial.id)
  const passport = await call('GET', `/api/materials/${materialId}/passport`, supplierJar)
  const passportRecord = dataOf(passport.body).passport
  assert.ok(isRecord(passportRecord))
  assert.equal((await call('PATCH', `/api/passports/${passportRecord.publicCode}/visibility`, supplierJar, { visibility: 'public' })).status, 200)
  const project = await call('POST', '/api/projects', buyerJar, {
    organizationId: buyerOrg,
    title: 'Obra de negociación',
    description: 'Prueba de contraoferta.',
    projectType: 'construction',
    city: 'Cali',
    department: 'Valle del Cauca',
    address: 'Calle reservada',
    startDate: '2026-11-01',
    endDate: '2026-12-31',
    status: 'active',
  })
  const createdProject = dataOf(project.body).project
  assert.ok(isRecord(createdProject))
  const need = await call('POST', `/api/projects/${createdProject.id}/needs`, buyerJar, {
    title: 'Ladrillos para negociar',
    description: 'Misma unidad y categoría.',
    categoryId,
    requiredQuantity: 200,
    unitId,
    status: 'open',
  })
  const createdNeed = dataOf(need.body).need
  assert.ok(isRecord(createdNeed))
  const needId = Number(createdNeed.id)

  const draft = await call('POST', '/api/material-requests', buyerJar, { materialId, needId, quantity: 80, submit: false }, 'fase9-borrador')
  assert.equal(draft.status, 201)
  const draftRequest = dataOf(draft.body).request
  assert.ok(isRecord(draftRequest))
  assert.equal(draftRequest.status, 'draft')
  const submitted = await call('POST', `/api/material-requests/${draftRequest.id}/submit`, buyerJar, {}, 'fase9-enviar')
  assert.equal(submitted.status, 200)
  const sent = dataOf(submitted.body).request
  assert.ok(isRecord(sent))
  assert.equal(sent.status, 'submitted')

  const countered = await call('POST', `/api/material-requests/${draftRequest.id}/counteroffer`, supplierJar, { quantity: 60, conditions: 'Solo hay 60 unidades listas.' }, 'fase9-contra')
  assert.equal(countered.status, 200, JSON.stringify(countered.body.error ?? countered.body))
  const supplierAcceptsCounter = await call('POST', `/api/material-requests/${draftRequest.id}/accept`, supplierJar, {}, 'fase9-contra-oferente')
  assert.equal(supplierAcceptsCounter.status, 403)
  const accepted = await call('POST', `/api/material-requests/${draftRequest.id}/accept`, buyerJar, {}, 'fase9-contra-aceptar')
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body.error ?? accepted.body))
  const reserved = dataOf(accepted.body)
  const reservedRequest = reserved.request
  const proposals = reserved.proposals
  assert.ok(isRecord(reservedRequest) && Array.isArray(proposals))
  assert.equal(reservedRequest.status, 'accepted')
  assert.equal(reservedRequest.requestedQuantity, 60)
  assert.equal(proposals.length, 2)
  const { getPool } = await import('../../config/database.js')
  const [summary] = await getPool().query<RowDataPacket[]>('SELECT quantity FROM materials WHERE id = ?', [materialId])
  assert.equal(Number(summary[0]?.quantity), 100)
  const [view] = await getPool().query<RowDataPacket[]>('SELECT available_quantity, committed_quantity FROM material_quantity_summary WHERE material_id = ?', [materialId])
  assert.equal(Number(view[0]?.committed_quantity), 60)
  assert.equal(Number(view[0]?.available_quantity), 40)

  const logistics = await call('POST', `/api/material-requests/${draftRequest.id}/logistics`, supplierJar, {
    mode: 'pickup_by_requester',
    originCity: 'Cali',
    originDepartment: 'Valle del Cauca',
    status: 'scheduled',
    pickupPlace: 'Portería de prueba',
  }, 'fase9-coordinar')
  assert.equal(logistics.status, 200, JSON.stringify(logistics.body.error ?? logistics.body))
  const coordinated = dataOf(logistics.body).request
  assert.ok(isRecord(coordinated))
  assert.equal(coordinated.logisticsStatus, 'scheduled')
  const jump = await call('POST', `/api/material-requests/${draftRequest.id}/reject`, supplierJar, {}, 'fase9-rechazo-tarde')
  assert.equal(jump.status, 409)

  const rejected = await call('POST', '/api/material-requests', buyerJar, { materialId, needId, quantity: 10 }, 'fase9-rechazo')
  const rejectedRequest = dataOf(rejected.body).request
  assert.ok(isRecord(rejectedRequest))
  const rejection = await call('POST', `/api/material-requests/${rejectedRequest.id}/reject`, supplierJar, {}, 'fase9-rechazar')
  assert.equal(rejection.status, 200)
  const rejectionBody = dataOf(rejection.body).request
  assert.ok(isRecord(rejectionBody))
  assert.equal(rejectionBody.status, 'rejected')
  const acceptRejected = await call('POST', `/api/material-requests/${rejectedRequest.id}/accept`, supplierJar, {}, 'fase9-aceptar-rechazada')
  assert.equal(acceptRejected.status, 409)

  const stranger = new Jar()
  await register(stranger, email('archivo-ajeno'), 'Ajena de archivos')
  await createOrganization(stranger, createdEmails[createdEmails.length - 1] ?? '', 'Ajena de archivos')
  const invalidFile = new FormData()
  invalidFile.set('file', new Blob([Buffer.from('no es un documento')], { type: 'text/plain' }), 'nota.txt')
  const invalidUpload = await fetch(`${baseUrl}/api/material-requests/${draftRequest.id}/documents`, {
    method: 'POST',
    headers: { cookie: buyerJar.header(), 'x-csrf-token': buyerJar.csrf(), accept: 'application/json' },
    body: invalidFile,
  })
  assert.equal(invalidUpload.status, 400)
  const validFile = new FormData()
  validFile.set('file', new Blob([png], { type: 'image/png' }), 'recepcion.png')
  const validUpload = await fetch(`${baseUrl}/api/material-requests/${draftRequest.id}/documents`, {
    method: 'POST',
    headers: { cookie: buyerJar.header(), 'x-csrf-token': buyerJar.csrf(), accept: 'application/json' },
    body: validFile,
  })
  assert.equal(validUpload.status, 201)
  const uploaded: unknown = await validUpload.json()
  assert.ok(isRecord(uploaded) && isRecord(uploaded.data) && Array.isArray(uploaded.data.documents))
  const document = uploaded.data.documents[0]
  assert.ok(isRecord(document))
  assert.equal(document.verified, false)
  const hiddenDocument = await call('GET', `/api/material-requests/${draftRequest.id}/documents/${document.id}`, stranger)
  assert.equal(hiddenDocument.status, 404)

  const matches = await call('GET', `/api/needs/${needId}/matches`, buyerJar)
  assert.equal(matches.status, 200, JSON.stringify(matches.body.error ?? matches.body))
  const report = dataOf(matches.body)
  const cards = [...(Array.isArray(report.matches) ? report.matches : []), ...(Array.isArray(report.excluded) ? report.excluded : [])]
  const card = cards.find((item) => isRecord(item) && Number(item.materialId) === materialId)
  assert.ok(isRecord(card))
  assert.equal(card.availableQuantity, 40)
  const listed = await call('GET', '/api/material-requests?box=sent&q=Ladrillos%20de%20contraoferta', buyerJar)
  assert.equal(listed.status, 200)
  const requests = dataOf(listed.body).requests
  assert.ok(Array.isArray(requests) && requests.some((item) => isRecord(item) && item.id === draftRequest.id))
})
