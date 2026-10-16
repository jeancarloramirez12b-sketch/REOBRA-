import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
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
  header(): string { return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ') }
  csrf(): string { return this.values.get('reobra_csrf') ?? '' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function email(label: string): string {
  const value = `fase10-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@reobra.test`
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

async function register(jar: Jar, address: string, name: string): Promise<number> {
  assert.equal((await call('POST', '/api/auth/register', jar, { fullName: name, email: address, password, acceptedTerms: true })).status, 201)
  const user = dataOf((await call('GET', '/api/auth/me', jar)).body).user
  assert.ok(isRecord(user))
  return Number(user.id)
}

async function createOrganization(jar: Jar, address: string, name: string): Promise<number> {
  const result = await call('POST', '/api/organizations', jar, { name, organizationType: 'company', contactEmail: address, city: 'Cali', department: 'Valle del Cauca', country: 'CO' })
  assert.equal(result.status, 201)
  const organization = dataOf(result.body).organization
  assert.ok(isRecord(organization))
  return Number(organization.id)
}

before(async () => {
  await import('../../config/env.js')
  const { readDatabaseConfig, closePool } = await import('../../config/database.js')
  if (readDatabaseConfig().database !== 'reobra') throw new Error('Las pruebas de impacto usan la base reobra.')
  const { migrateUp } = await import('../../database/migrator.js')
  await migrateUp()
  await closePool()
  const { createApp } = await import('../../app.js')
  const { getConfig } = await import('../../config/env.js')
  server = createApp(getConfig()).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No se pudo abrir el servidor de prueba.')
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`
  ready = true
})

after(async () => {
  if (server) {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
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
      const [reportRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM impact_reports WHERE organization_id IN (${ids})`, orgIds)
      const reportIds = reportRows.map((row) => Number(row.id))
      const [calculationRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM impact_calculations WHERE organization_id IN (${ids})`, orgIds)
      const calculationIds = calculationRows.map((row) => Number(row.id))
      if (reportIds.length > 0) {
        const reportPlaceholders = reportIds.map(() => '?').join(', ')
        await pool.query(`DELETE FROM impact_audit_events WHERE report_id IN (${reportPlaceholders})`, reportIds)
        await pool.query(`DELETE FROM impact_report_items WHERE report_id IN (${reportPlaceholders})`, reportIds)
        await pool.query(`DELETE FROM impact_reports WHERE id IN (${reportPlaceholders})`, reportIds)
      }
      if (calculationIds.length > 0) {
        const calculationPlaceholders = calculationIds.map(() => '?').join(', ')
        await pool.query(`DELETE FROM impact_audit_events WHERE calculation_id IN (${calculationPlaceholders})`, calculationIds)
        await pool.query(`DELETE FROM impact_calculation_sources WHERE calculation_id IN (${calculationPlaceholders})`, calculationIds)
        await pool.query(`DELETE FROM impact_calculations WHERE id IN (${calculationPlaceholders})`, calculationIds)
      }
      await pool.query(`DELETE FROM impact_audit_events WHERE organization_id IN (${ids})`, orgIds)
      await pool.query(`DELETE FROM impact_factors WHERE organization_id IN (${ids})`, orgIds)
      await pool.query(`DELETE FROM impact_methodologies WHERE organization_id IN (${ids})`, orgIds)
      await pool.query(`DELETE FROM impact_mass_parameters WHERE organization_id IN (${ids})`, orgIds)
      const [projectRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM projects WHERE organization_id IN (${ids})`, orgIds)
      const [materialRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM materials WHERE organization_id IN (${ids})`, orgIds)
      const materialIds = materialRows.map((row) => Number(row.id))
      const [requestRows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM material_requests WHERE requesting_organization_id IN (${ids}) ${materialIds.length > 0 ? `OR material_id IN (${materialIds.map(() => '?').join(', ')})` : ''}`,
        materialIds.length > 0 ? [...orgIds, ...materialIds] : orgIds,
      )
      const requestIds = requestRows.map((row) => Number(row.id))
      if (requestIds.length > 0) {
        const requestPlaceholders = requestIds.map(() => '?').join(', ')
        await pool.query(`DELETE FROM impact_audit_events WHERE delivery_id IN (SELECT id FROM deliveries WHERE request_id IN (${requestPlaceholders}))`, requestIds)
        await pool.query(`DELETE FROM operation_documents WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM logistics_incidents WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM operation_notifications WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM request_events WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM request_operations WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM request_proposals WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM deliveries WHERE request_id IN (${requestPlaceholders})`, requestIds)
        await pool.query(`DELETE FROM material_requests WHERE id IN (${requestPlaceholders})`, requestIds)
      }
      if (projectRows.length > 0) {
        const projectPlaceholders = projectRows.map(() => '?').join(', ')
        const projectIds = projectRows.map((row) => Number(row.id))
        await pool.query(`DELETE FROM project_events WHERE project_id IN (${projectPlaceholders})`, projectIds)
        await pool.query(`DELETE FROM project_material_needs WHERE project_id IN (${projectPlaceholders})`, projectIds)
        await pool.query(`DELETE FROM projects WHERE id IN (${projectPlaceholders})`, projectIds)
      }
      if (materialIds.length > 0) {
        const materialPlaceholders = materialIds.map(() => '?').join(', ')
        await pool.query(`DELETE FROM material_matches WHERE material_id IN (${materialPlaceholders})`, materialIds)
        await pool.query(`DELETE FROM material_trace_events WHERE material_id IN (${materialPlaceholders})`, materialIds)
        await pool.query(
          `DELETE revision FROM material_passport_revisions revision INNER JOIN material_passports passport ON passport.id = revision.passport_id WHERE passport.material_id IN (${materialPlaceholders})`,
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

test('35 ladrillos recibidos no se convierten en 60 ni en emisiones inventadas', async () => {
  const supplierJar = new Jar()
  const supplierEmail = email('oferente')
  await register(supplierJar, supplierEmail, 'Oferente de impacto')
  const supplierOrg = await createOrganization(supplierJar, supplierEmail, 'Acopio de impacto')
  const buyerJar = new Jar()
  const buyerEmail = email('receptor')
  const buyerId = await register(buyerJar, buyerEmail, 'Receptor de impacto')
  const buyerOrg = await createOrganization(buyerJar, buyerEmail, 'Obra de impacto')
  const categories = dataOf((await call('GET', '/api/material-categories', supplierJar)).body).categories
  const units = dataOf((await call('GET', '/api/measurement-units', supplierJar)).body).units
  assert.ok(Array.isArray(categories) && Array.isArray(units))
  const category = categories.find((item) => isRecord(item) && item.name === 'Mampostería')
  const unit = units.find((item) => isRecord(item) && item.code === 'unit')
  assert.ok(isRecord(category) && isRecord(unit))
  const material = await call('POST', '/api/materials', supplierJar, {
    organizationId: supplierOrg, categoryId: category.id, unitId: unit.id, title: 'Ladrillos de impacto sintético',
    description: 'Fixture de la fase 10. No es un inventario real.', materialCondition: 'fair', quantity: 100,
    originType: 'construction', city: 'Cali', department: 'Valle del Cauca', availabilityStatus: 'published',
  })
  const createdMaterial = dataOf(material.body).material
  assert.ok(isRecord(createdMaterial))
  const passport = dataOf((await call('GET', `/api/materials/${createdMaterial.id}/passport`, supplierJar)).body).passport
  assert.ok(isRecord(passport))
  assert.equal((await call('PATCH', `/api/passports/${passport.publicCode}/visibility`, supplierJar, { visibility: 'public' })).status, 200)
  const project = dataOf((await call('POST', '/api/projects', buyerJar, {
    organizationId: buyerOrg, title: 'Remodelación sostenible de institución educativa — Etapa 1', description: 'Proyecto sintético de impacto.',
    projectType: 'construction', city: 'Cali', department: 'Valle del Cauca', address: 'Calle de prueba', startDate: '2026-11-01', endDate: '2026-12-31', status: 'active',
  })).body).project
  assert.ok(isRecord(project))
  const need = dataOf((await call('POST', `/api/projects/${project.id}/needs`, buyerJar, {
    title: 'Ladrillos reutilizables', description: 'Necesidad sintética.', categoryId: category.id, requiredQuantity: 650, unitId: unit.id, status: 'open',
  })).body).need
  assert.ok(isRecord(need))
  const request = dataOf((await call('POST', '/api/material-requests', buyerJar, { materialId: createdMaterial.id, needId: need.id, quantity: 60 }, 'fase10-solicitud')).body).request
  assert.ok(isRecord(request))
  assert.equal((await call('POST', `/api/material-requests/${request.id}/accept`, supplierJar, {}, 'fase10-aceptar')).status, 200)
  const reservedOnly = dataOf((await call('POST', '/api/material-requests', buyerJar, { materialId: createdMaterial.id, needId: need.id, quantity: 20 }, 'fase10-reserva')).body).request
  assert.ok(isRecord(reservedOnly))
  assert.equal((await call('POST', `/api/material-requests/${reservedOnly.id}/accept`, supplierJar, {}, 'fase10-reserva-aceptar')).status, 200)
  const dispatched = await call('POST', `/api/material-requests/${request.id}/dispatch`, supplierJar, { quantity: 60, occurredAt: new Date().toISOString() }, 'fase10-salida')
  assert.equal(dispatched.status, 200, JSON.stringify(dispatched.body.error ?? dispatched.body))
  const deliveries = dataOf(dispatched.body).deliveries
  assert.ok(Array.isArray(deliveries) && isRecord(deliveries[0]))
  assert.equal((await call('POST', `/api/material-requests/${request.id}/deliveries/${deliveries[0].id}/receive`, buyerJar, { quantity: 35, occurredAt: new Date().toISOString(), condition: 'fair' }, 'fase10-recepcion')).status, 200)
  const { getPool } = await import('../../config/database.js')
  await getPool().query(`INSERT INTO organization_members (organization_id, user_id, role, membership_status) VALUES (?, ?, 'viewer', 'active')`, [supplierOrg, buyerId])

  const period = 'organizationId=' + buyerOrg + '&from=2026-01-01&to=2026-12-31'
  const overview = await call('GET', `/api/impact/overview?${period}`, buyerJar)
  assert.equal(overview.status, 200, JSON.stringify(overview.body.error ?? overview.body))
  const summary = dataOf(overview.body)
  const received = summary.receivedByUnit
  assert.ok(Array.isArray(received) && isRecord(received[0]))
  assert.equal(received[0].quantity, 35)
  assert.equal(received[0].unitCode, 'unit')
  const receivedCategories = summary.receivedByCategory
  assert.ok(Array.isArray(receivedCategories) && isRecord(receivedCategories[0]))
  assert.equal(receivedCategories[0].category, 'Mampostería')
  assert.equal(receivedCategories[0].quantity, 35)
  assert.equal(summary.incorporation && isRecord(summary.incorporation) ? summary.incorporation.status : '', 'not_documented')
  assert.equal(summary.environmental && isRecord(summary.environmental) ? summary.environmental.status : '', 'not_calculable')
  assert.equal(summary.mass && isRecord(summary.mass) ? summary.mass.status : '', 'not_calculable')
  const both = dataOf((await call('GET', '/api/impact/overview?from=2026-01-01&to=2026-12-31', buyerJar)).body)
  const combined = both.receivedByUnit
  assert.ok(Array.isArray(combined) && isRecord(combined[0]))
  assert.equal(combined[0].quantity, 35)
  const projectImpact = dataOf((await call('GET', `/api/impact/projects/${project.id}`, buyerJar)).body)
  const needs = projectImpact.needs
  assert.ok(Array.isArray(needs) && isRecord(needs[0]))
  assert.equal(needs[0].receivedQuantity, 35)
  assert.equal(needs[0].coveragePercent, 5.38)
  assert.equal(needs[0].pendingQuantity, 615)
  const outside = dataOf((await call('GET', `/api/impact/overview?${period.replace('2026-01-01', '2020-01-01').replace('2026-12-31', '2020-12-31')}`, buyerJar)).body)
  assert.ok(Array.isArray(outside.receivedByUnit) && outside.receivedByUnit.length === 0)
  const stranger = new Jar()
  const strangerEmail = email('ajena')
  await register(stranger, strangerEmail, 'Ajena de impacto')
  await createOrganization(stranger, strangerEmail, 'Ajena de impacto')
  assert.equal((await call('GET', `/api/impact/organizations/${buyerOrg}`, stranger)).status, 404)

  const methodology = dataOf((await call('POST', '/api/impact/methodologies', buyerJar, {
    organizationId: buyerOrg, name: 'Metodología sintética fase 10', versionLabel: 'v0-prueba',
    statement: 'Multiplica la masa declarada por un factor de prueba. No representa un factor oficial.',
    limitations: 'Fixture sintético. No certifica emisiones.',
  })).body).methodology
  assert.ok(isRecord(methodology))
  assert.equal((await call('POST', `/api/impact/methodologies/${methodology.id}/approve`, buyerJar, {})).status, 200)
  const factor = dataOf((await call('POST', '/api/impact/factors', buyerJar, {
    methodologyId: methodology.id, impactKind: 'emissions_estimate', inputUnitCode: 'kg', outputUnit: 'kgCO2e', value: 1.5,
    sourceName: 'Fuente sintética de prueba', issuerName: 'Fixture REOBRA', year: 2026, regionName: 'Prueba', versionLabel: 'v0',
    conditions: 'Solo para la prueba automatizada. No es un factor oficial.',
  })).body).factor
  assert.ok(isRecord(factor))
  assert.equal((await call('PATCH', `/api/impact/factors/${factor.id}`, buyerJar, { value: 9 })).status, 400)
  assert.equal((await call('PATCH', `/api/impact/factors/${factor.id}`, buyerJar, { status: 'reviewed' })).status, 200)
  assert.equal((await call('PATCH', `/api/impact/factors/${factor.id}`, buyerJar, { status: 'approved' })).status, 200)
  const missing = await call('POST', '/api/impact/calculations', buyerJar, { organizationId: buyerOrg, factorId: factor.id, from: '2026-01-01', to: '2026-12-31' }, 'fase10-calculo')
  assert.equal(missing.status, 201)
  const missingCalculation = dataOf(missing.body).calculation
  assert.ok(isRecord(missingCalculation))
  assert.equal(missingCalculation.status, 'not_calculable')
  assert.equal((await call('POST', '/api/impact/mass-parameters', buyerJar, { materialId: createdMaterial.id, kind: 'mass_per_unit', magnitude: 2, sourceNote: 'Parámetro sintético de prueba: 2 kg por unidad.' })).status, 403)
  assert.equal((await call('POST', '/api/impact/mass-parameters', supplierJar, { materialId: createdMaterial.id, kind: 'mass_per_unit', magnitude: 2, sourceNote: 'Parámetro sintético de prueba: 2 kg por unidad.' })).status, 201)
  const estimated = await call('POST', '/api/impact/calculations', buyerJar, { organizationId: buyerOrg, factorId: factor.id, from: '2026-01-01', to: '2026-12-31' }, 'fase10-calculo-2')
  assert.equal(estimated.status, 201, JSON.stringify(estimated.body.error ?? estimated.body))
  const calculation = dataOf(estimated.body).calculation
  assert.ok(isRecord(calculation))
  assert.equal(calculation.status, 'calculated')
  assert.equal(calculation.resultValue, 105)
  const repeated = await call('POST', '/api/impact/calculations', buyerJar, { organizationId: buyerOrg, factorId: factor.id, from: '2026-01-01', to: '2026-12-31' }, 'fase10-calculo-2')
  const repeatedCalculation = dataOf(repeated.body).calculation
  assert.ok(isRecord(repeatedCalculation))
  assert.equal(repeatedCalculation.id, calculation.id)
  const [count] = await getPool().query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM impact_calculations WHERE factor_id = ?', [factor.id])
  assert.equal(Number(count[0]?.total), 1)

  const report = await call('POST', '/api/impact/reports', buyerJar, { organizationId: buyerOrg, projectId: project.id, from: '2026-01-01', to: '2026-12-31', methodologyId: methodology.id }, 'fase10-informe')
  assert.equal(report.status, 201, JSON.stringify(report.body.error ?? report.body))
  const issued = dataOf(report.body)
  const issuedReport = issued.report
  const items = issued.items
  assert.ok(isRecord(issuedReport) && Array.isArray(items))
  assert.ok(items.some((item) => isRecord(item) && item.code === 'received_confirmed' && item.value === '35'))
  const again = dataOf((await call('POST', '/api/impact/reports', buyerJar, { organizationId: buyerOrg, projectId: project.id, from: '2026-01-01', to: '2026-12-31', methodologyId: methodology.id }, 'fase10-informe')).body)
  assert.equal(isRecord(again.report) ? again.report.id : 0, issuedReport.id)
  assert.equal((await call('POST', `/api/impact/receipts/${deliveries[0].id}/corrections`, buyerJar, { quantity: 30, reason: 'Corrección sintética de prueba.' }, 'fase10-correccion')).status, 200)
  const afterCorrection = dataOf((await call('GET', `/api/impact/projects/${project.id}`, buyerJar)).body).needs
  assert.ok(Array.isArray(afterCorrection) && isRecord(afterCorrection[0]))
  assert.equal(afterCorrection[0].receivedQuantity, 30)
  const frozen = dataOf((await call('GET', `/api/impact/reports/${issuedReport.id}`, buyerJar)).body).items
  assert.ok(Array.isArray(frozen) && frozen.some((item) => isRecord(item) && item.value === '35'))
  const exported = await fetch(`${baseUrl}/api/impact/reports/${issuedReport.id}/export?format=csv`, { headers: { cookie: buyerJar.header(), accept: 'text/csv' } })
  assert.equal(exported.status, 200)
  assert.match(await exported.text(), /35/)
  const hiddenExport = await fetch(`${baseUrl}/api/impact/reports/${issuedReport.id}/export?format=pdf`, { headers: { cookie: stranger.header(), accept: 'application/pdf' } })
  assert.equal(hiddenExport.status, 404)
})
