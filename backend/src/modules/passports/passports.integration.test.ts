import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import type { Express } from 'express'
import type { RowDataPacket } from 'mysql2'
import { recordTraceEvent } from './trace.js'

process.env.NODE_ENV = 'test'
process.env.PORT ??= '3001'
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173'

const password = 'una-clave-larga'
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
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
  const value = `fase6-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@reobra.test`
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
): Promise<{ status: number; body: Record<string, unknown>; text: string; contentType: string }> {
  const headers = new Headers({ Accept: 'application/json' })
  const cookie = jar.header()
  if (cookie) {
    headers.set('cookie', cookie)
  }
  if (body !== undefined && !(body instanceof FormData)) {
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
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  jar.store(response)
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  if (contentType.includes('json')) {
    const payload: unknown = JSON.parse(text)
    assert.ok(isRecord(payload))
    return { status: response.status, body: payload, text, contentType }
  }
  return { status: response.status, body: {}, text, contentType }
}

function dataOf(body: Record<string, unknown>): Record<string, unknown> {
  assert.equal(body.success, true)
  assert.ok(isRecord(body.data))
  return body.data
}

async function register(jar: Jar, address: string): Promise<number> {
  const result = await call('POST', '/api/auth/register', jar, {
    fullName: 'Persona de pasaporte',
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

async function createOrganization(jar: Jar, address: string, name: string): Promise<number> {
  const result = await call('POST', '/api/organizations', jar, {
    name,
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

async function catalog(jar: Jar): Promise<{ categoryId: number; unitId: number }> {
  const categories = await call('GET', '/api/material-categories', jar)
  const units = await call('GET', '/api/measurement-units', jar)
  const categoryList = dataOf(categories.body).categories
  const unitList = dataOf(units.body).units
  assert.ok(Array.isArray(categoryList) && Array.isArray(unitList))
  const category = categoryList.find((item) => isRecord(item))
  const unit = unitList.find((item) => isRecord(item) && item.code === 'kg')
  assert.ok(isRecord(category) && isRecord(unit))
  return { categoryId: Number(category.id), unitId: Number(unit.id) }
}

function materialBody(organizationId: number, categoryId: number, unitId: number, title: string) {
  return {
    organizationId,
    categoryId,
    unitId,
    title,
    description: 'Pieza declarada para el pasaporte',
    materialCondition: 'good',
    quantity: '6',
    originType: 'construction',
    city: 'Medellín',
    department: 'Antioquia',
    locationDescription: 'Referencia interna de patio',
    availabilityStatus: 'published',
  }
}

before(async () => {
  await import('../../config/env.js')
  const { readDatabaseConfig, closePool } = await import('../../config/database.js')
  if (readDatabaseConfig().database !== 'reobra') {
    throw new Error('Las pruebas de pasaporte usan la base reobra y solo borran correos fase6-…@reobra.test.')
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
  const { removeDocumentFile } = await import('./document-storage.js')
  const pool = getPool()
  const [databaseRows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name')
  if (databaseRows[0]?.name !== 'reobra') {
    throw new Error('Se evitó limpiar una base distinta de reobra.')
  }
  const placeholders = createdEmails.map(() => '?').join(', ')
  const [userRows] = await pool.query<RowDataPacket[]>(`SELECT id FROM users WHERE email IN (${placeholders})`, createdEmails)
  const userIds = userRows.map((row) => Number(row.id))
  const [orgRows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM organizations WHERE contact_email IN (${placeholders})`,
    createdEmails,
  )
  const orgIds = orgRows.map((row) => Number(row.id))
  const materialClauses: string[] = []
  const materialParams: number[] = []
  if (userIds.length > 0) {
    materialClauses.push(`created_by_user_id IN (${userIds.map(() => '?').join(', ')})`)
    materialParams.push(...userIds)
  }
  if (orgIds.length > 0) {
    materialClauses.push(`organization_id IN (${orgIds.map(() => '?').join(', ')})`)
    materialParams.push(...orgIds)
  }
  if (materialClauses.length > 0) {
    const [materialRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM materials WHERE ${materialClauses.join(' OR ')}`,
      materialParams,
    )
    const materialIds = materialRows.map((row) => Number(row.id))
    if (materialIds.length > 0) {
      const ids = materialIds.map(() => '?').join(', ')
      const [documents] = await pool.query<RowDataPacket[]>(
        `SELECT storage_key FROM material_documents WHERE material_id IN (${ids})`,
        materialIds,
      )
      await pool.query(`DELETE FROM material_documents WHERE material_id IN (${ids})`, materialIds)
      await pool.query(
        `DELETE revision FROM material_passport_revisions revision
         INNER JOIN material_passports passport ON passport.id = revision.passport_id
         WHERE passport.material_id IN (${ids})`,
        materialIds,
      )
      await pool.query(`DELETE FROM material_passports WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM material_trace_events WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM material_images WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM materials WHERE id IN (${ids})`, materialIds)
      for (const row of documents) {
        if (typeof row.storage_key === 'string') {
          await removeDocumentFile(row.storage_key)
        }
      }
    }
  }
  await pool.query(`DELETE FROM organization_invitations WHERE email IN (${placeholders})`, createdEmails)
  if (userIds.length > 0) {
    const users = userIds.map(() => '?').join(', ')
    await pool.query(`DELETE FROM sessions WHERE user_id IN (${users})`, userIds)
    await pool.query(`DELETE FROM organization_members WHERE user_id IN (${users})`, userIds)
  }
  await pool.query(
    `DELETE FROM organizations WHERE contact_email IN (${placeholders}) AND id NOT IN (SELECT organization_id FROM organization_members)`,
    createdEmails,
  )
  await pool.query(`DELETE FROM users WHERE email IN (${placeholders})`, createdEmails)
  await pool.query(
    `DELETE FROM login_attempts WHERE email_hash IN (${createdEmails.map(() => '?').join(', ')})`,
    createdEmails.map((value) => sha256(value)),
  )
  await closePool()
})

test('los materiales existentes y los nuevos tienen una identidad pública estable', async () => {
  const { getPool } = await import('../../config/database.js')
  const pool = getPool()
  const [missing] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM materials m
     LEFT JOIN material_passports p ON p.material_id = m.id
     WHERE p.id IS NULL`,
  )
  assert.equal(Number(missing[0]?.total), 0)
  const [codes] = await pool.query<RowDataPacket[]>(
    `SELECT public_code, COUNT(*) AS total
     FROM material_passports
     GROUP BY public_code
     HAVING total > 1`,
  )
  assert.equal(codes.length, 0)

  const owner = new Jar()
  const ownerEmail = email('identidad')
  await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail, 'Acopio pasaporte')
  const { categoryId, unitId } = await catalog(owner)
  const created = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, 'Perfil metálico'))
  assert.equal(created.status, 201)
  const material = dataOf(created.body).material
  assert.ok(isRecord(material))
  assert.equal('publicCode' in material, false)
  const passport = await call('GET', `/api/materials/${Number(material.id)}/passport`, owner)
  assert.equal(passport.status, 200)
  const first = dataOf(passport.body).passport
  assert.ok(isRecord(first))
  const publicCode = String(first.publicCode)
  assert.match(publicCode, /^rob_[a-z0-9]{20}$/)
  assert.equal(first.audience, 'private')
  assert.equal(first.visibility, 'private')
  assert.equal(first.technicalValidationStatus, 'pending')
  assert.equal(String(first.technicalNote).includes('certifica'), true)
  assert.equal(JSON.stringify(first).toLowerCase().includes('certificado'), false)

  const renamed = await call('PATCH', `/api/materials/${Number(material.id)}`, owner, { title: 'Perfil metálico corregido' })
  assert.equal(renamed.status, 200)
  const again = await call('GET', `/api/passports/${publicCode}`, owner)
  const second = dataOf(again.body).passport
  assert.ok(isRecord(second))
  assert.equal(second.publicCode, publicCode)
  assert.equal(second.title, 'Perfil metálico corregido')
  assert.equal(second.locationDescription, 'Referencia interna de patio')

  const other = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, 'Otro perfil'))
  const otherMaterial = dataOf(other.body).material
  assert.ok(isRecord(otherMaterial))
  const otherPassport = dataOf((await call('GET', `/api/materials/${Number(otherMaterial.id)}/passport`, owner)).body).passport
  assert.ok(isRecord(otherPassport))
  assert.notEqual(otherPassport.publicCode, publicCode)
})

test('la visibilidad pública oculta datos internos y el QR no lleva secretos', async () => {
  const owner = new Jar()
  const ownerEmail = email('publico')
  await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail, 'Acopio público')
  const { categoryId, unitId } = await catalog(owner)
  const created = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, 'Lámina publicada'))
  const materialId = Number((dataOf(created.body).material as Record<string, unknown>).id)
  const passport = dataOf((await call('GET', `/api/materials/${materialId}/passport`, owner)).body).passport
  assert.ok(isRecord(passport))
  const publicCode = String(passport.publicCode)

  const hidden = await call('GET', `/api/passports/${publicCode}`, new Jar(), undefined, false)
  assert.equal(hidden.status, 404)

  const stranger = new Jar()
  await register(stranger, email('ajena'))
  const viewer = new Jar()
  const viewerId = await register(viewer, email('consulta'))
  const { getPool } = await import('../../config/database.js')
  await getPool().query(
    `INSERT INTO organization_members (organization_id, user_id, role, membership_status) VALUES (?, ?, 'viewer', 'active')`,
    [organizationId, viewerId],
  )
  const denied = await call('PATCH', `/api/passports/${publicCode}/visibility`, stranger, { visibility: 'public' })
  assert.equal(denied.status, 404)
  const forbidden = await call('PATCH', `/api/passports/${publicCode}/visibility`, viewer, { visibility: 'public' })
  assert.equal(forbidden.status, 403)
  const missingQr = await call('GET', `/api/passports/rob_00000000000000000000/qr`, owner)
  assert.equal(missingQr.status, 404)

  const published = await call('PATCH', `/api/passports/${publicCode}/visibility`, owner, { visibility: 'public' })
  assert.equal(published.status, 200)
  const anon = await call('GET', `/api/passports/${publicCode}`, new Jar(), undefined, false)
  assert.equal(anon.status, 200)
  const publicPassport = dataOf(anon.body).passport
  assert.ok(isRecord(publicPassport))
  assert.equal(publicPassport.audience, 'public')
  assert.equal(publicPassport.locationDescription, null)
  assert.equal('materialId' in publicPassport, false)
  assert.equal(JSON.stringify(publicPassport).includes(ownerEmail), false)
  assert.equal(String(publicPassport.qrUrl).endsWith(`/pasaporte/${publicCode}`), true)
  assert.equal(String(publicPassport.qrUrl).includes('token'), false)

  const qr = await call('GET', `/api/passports/${publicCode}/qr`, new Jar(), undefined, false)
  assert.equal(qr.status, 200)
  assert.equal(qr.contentType.includes('image/svg+xml'), true)
  assert.equal(qr.text.includes('<svg'), true)
  assert.equal(qr.text.includes(password), false)
  assert.equal(qr.text.includes(ownerEmail), false)

  const events = await call('GET', `/api/passports/${publicCode}/events`, new Jar(), undefined, false)
  assert.equal(events.status, 401)
  const forged = await call('POST', `/api/passports/${publicCode}/events`, owner, { description: 'No debe guardarse' })
  assert.equal(forged.status, 404)

  await call('PATCH', `/api/materials/${materialId}/status`, owner, { availabilityStatus: 'withdrawn' })
  const afterWithdraw = await call('GET', `/api/passports/${publicCode}`, new Jar(), undefined, false)
  assert.equal(afterWithdraw.status, 404)
  const internal = dataOf((await call('GET', `/api/passports/${publicCode}`, owner)).body).passport
  assert.ok(isRecord(internal))
  assert.equal(internal.visibility, 'private')
  assert.equal(internal.availabilityStatus, 'withdrawn')
})

test('el historial se agrega, no se edita y una transacción fallida no lo confirma', async () => {
  const owner = new Jar()
  const ownerEmail = email('historial')
  await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail, 'Acopio historial')
  const { categoryId, unitId } = await catalog(owner)
  const created = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, 'Bloque trazable'))
  const materialId = Number((dataOf(created.body).material as Record<string, unknown>).id)
  const passport = dataOf((await call('GET', `/api/materials/${materialId}/passport`, owner)).body).passport
  assert.ok(isRecord(passport))
  const publicCode = String(passport.publicCode)
  const key = 'fase6-idem-123456'
  const first = await call('PATCH', `/api/materials/${materialId}`, owner, { city: 'Bello' }, true, { 'idempotency-key': key })
  assert.equal(first.status, 200)
  const second = await call('PATCH', `/api/materials/${materialId}`, owner, { city: 'Envigado' }, true, { 'idempotency-key': key })
  assert.equal(second.status, 200)
  assert.equal((dataOf(second.body).material as Record<string, unknown>).city, 'Bello')

  const history = await call('GET', `/api/passports/${publicCode}/events`, owner)
  const events = dataOf(history.body).events
  assert.ok(Array.isArray(events))
  const types = events.map((event) => (isRecord(event) ? event.eventType : ''))
  assert.equal(types[0], 'registered')
  assert.equal(types.includes('passport_issued'), true)
  assert.equal(types.filter((type) => type === 'details_updated').length, 1)
  assert.equal(types.includes('passport_revised'), true)
  const detail = events.find((event) => isRecord(event) && event.eventType === 'details_updated')
  assert.ok(isRecord(detail))
  assert.equal(detail.actorName, 'Persona de pasaporte')
  assert.notEqual(detail.eventTimestamp, 'No registrado')

  const { getPool } = await import('../../config/database.js')
  const { withTransaction } = await import('../../utils/sql.js')
  const pool = getPool()
  const [before] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM material_trace_events WHERE material_id = ?', [
    materialId,
  ])
  await assert.rejects(
    withTransaction(async (connection) => {
      await recordTraceEvent(connection, {
        materialId,
        actorUserId: null,
        organizationId,
        eventType: 'note',
        description: 'Este evento debe revertirse.',
        operationKey: 'fase6-rollback-0001',
      })
      throw new Error('fallo controlado')
    }),
    /fallo controlado/,
  )
  const [afterCount] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM material_trace_events WHERE material_id = ?',
    [materialId],
  )
  assert.equal(Number(afterCount[0]?.total), Number(before[0]?.total))
})

test('los documentos se aíslan y una revisión no certifica el material', async () => {
  const owner = new Jar()
  const ownerEmail = email('documento')
  const ownerId = await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail, 'Acopio documentos')
  const { categoryId, unitId } = await catalog(owner)
  const created = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, 'Ficha declarada'))
  const materialId = Number((dataOf(created.body).material as Record<string, unknown>).id)
  const publicCode = String(
    (dataOf((await call('GET', `/api/materials/${materialId}/passport`, owner)).body).passport as Record<string, unknown>).publicCode,
  )
  const reviewer = new Jar()
  const reviewerEmail = email('revisor')
  const reviewerId = await register(reviewer, reviewerEmail)
  const { getPool } = await import('../../config/database.js')
  await getPool().query(
    `INSERT INTO organization_members (organization_id, user_id, role, membership_status) VALUES (?, ?, 'technical_reviewer', 'active')`,
    [organizationId, reviewerId],
  )
  assert.ok(ownerId > 0)

  const form = new FormData()
  form.set('document', new File([pdf], 'ficha.pdf', { type: 'application/pdf' }))
  form.set('evidenceKind', 'technical_sheet')
  form.set('disclosure', 'internal')
  const uploaded = await call('POST', `/api/passports/${publicCode}/evidence`, owner, form)
  assert.equal(uploaded.status, 201)
  const document = dataOf(uploaded.body).document
  assert.ok(isRecord(document))
  assert.equal(document.reviewStatus, 'received')
  const documentId = Number(document.id)

  const stranger = new Jar()
  await register(stranger, email('fuera-doc'))
  const hidden = await call('GET', `/api/passports/${publicCode}/evidence/${documentId}`, stranger)
  assert.equal(hidden.status, 404)
  const anonymous = await call('GET', `/api/passports/${publicCode}/evidence/${documentId}`, new Jar(), undefined, false)
  assert.equal(anonymous.status, 404)

  const owned = await call('GET', `/api/passports/${publicCode}/evidence/${documentId}`, owner)
  assert.equal(owned.status, 200)
  assert.equal(owned.contentType.includes('application/pdf'), true)
  assert.equal(owned.text.startsWith('%PDF-'), true)

  const reviewed = await call('PATCH', `/api/passports/${publicCode}/evidence/${documentId}`, reviewer, { reviewStatus: 'reviewed' })
  assert.equal(reviewed.status, 200)
  const history = dataOf((await call('GET', `/api/passports/${publicCode}/events`, owner)).body).events
  assert.ok(Array.isArray(history))
  const note = history.find((event) => isRecord(event) && String(event.description).includes('revisado'))
  assert.ok(isRecord(note))
  assert.equal(String(note.description).toLowerCase().includes('certifica'), true)
  assert.equal(String(note.description).toLowerCase().includes('certificado'), false)

  const textClaim = await call('PATCH', `/api/passports/${publicCode}/evidence/${documentId}`, reviewer, {
    reviewStatus: 'suitable_for_stated_use',
  })
  assert.equal(textClaim.status, 400)
})
