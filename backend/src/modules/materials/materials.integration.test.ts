import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import type { Express } from 'express'
import type { RowDataPacket } from 'mysql2'
import { AppError } from '../../errors/AppError.js'
import { mapDatabaseError } from './material.service.js'
import { removeMaterialFile } from './storage.js'

process.env.NODE_ENV = 'test'
process.env.PORT ??= '3001'
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173'

const password = 'una-clave-larga'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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
  const value = `fase5-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@reobra.test`
  createdEmails.push(value)
  return value
}

async function call(
  method: string,
  path: string,
  jar: Jar,
  body?: unknown,
  csrf = true,
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

function errorOf(body: Record<string, unknown>): { code: string } {
  assert.equal(body.success, false)
  assert.ok(isRecord(body.error))
  return { code: String(body.error.code) }
}

function materialOf(body: Record<string, unknown>): Record<string, unknown> {
  const material = dataOf(body).material
  assert.ok(isRecord(material))
  return material
}

async function register(jar: Jar, address: string): Promise<number> {
  const result = await call('POST', '/api/auth/register', jar, {
    fullName: 'Persona de inventario',
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
  assert.equal(organization.verificationStatus, 'unverified')
  return Number(organization.id)
}

async function catalog(jar: Jar): Promise<{ categoryId: number; unitId: number }> {
  const categories = await call('GET', '/api/material-categories', jar)
  const units = await call('GET', '/api/measurement-units', jar)
  assert.equal(categories.status, 200)
  assert.equal(units.status, 200)
  const categoryList = dataOf(categories.body).categories
  const unitList = dataOf(units.body).units
  assert.ok(Array.isArray(categoryList) && categoryList.length > 0)
  assert.ok(Array.isArray(unitList))
  const category = categoryList.find((item) => isRecord(item))
  const unit = unitList.find((item) => isRecord(item) && item.code === 'kg')
  assert.ok(isRecord(category))
  assert.ok(isRecord(unit))
  return { categoryId: Number(category.id), unitId: Number(unit.id) }
}

function materialBody(
  organizationId: number,
  categoryId: number,
  unitId: number,
  title: string,
  quantity: string | number = '8.5',
  extras: Record<string, unknown> = {},
) {
  return {
    organizationId,
    categoryId,
    unitId,
    title,
    description: 'Pieza recuperada para prueba',
    materialCondition: 'good',
    quantity,
    originType: 'construction',
    city: 'Medellín',
    department: 'Antioquia',
    locationDescription: 'Patio general de acopio',
    availabilityStatus: 'published',
    availableFrom: '2026-10-20',
    ...extras,
  }
}

before(async () => {
  await import('../../config/env.js')
  const { readDatabaseConfig, closePool } = await import('../../config/database.js')
  if (readDatabaseConfig().database !== 'reobra') {
    throw new Error('Las pruebas de inventario usan la base reobra y solo borran correos fase5-…@reobra.test.')
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
  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM users WHERE email IN (${placeholders})`,
    createdEmails,
  )
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
      const [imageRows] = await pool.query<RowDataPacket[]>(
        `SELECT storage_key FROM material_images WHERE material_id IN (${ids})`,
        materialIds,
      )
      await pool.query(
        `DELETE evidence FROM impact_evidence evidence
         INNER JOIN impact_records impact ON impact.id = evidence.impact_record_id
         WHERE impact.material_id IN (${ids})`,
        materialIds,
      )
      await pool.query(`DELETE FROM impact_records WHERE material_id IN (${ids})`, materialIds)
      await pool.query(
        `DELETE revision FROM material_passport_revisions revision
         INNER JOIN material_passports passport ON passport.id = revision.passport_id
         WHERE passport.material_id IN (${ids})`,
        materialIds,
      )
      await pool.query(`DELETE FROM material_passports WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM material_trace_events WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM technical_assessments WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM material_documents WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM material_images WHERE material_id IN (${ids})`, materialIds)
      await pool.query(
        `DELETE delivery FROM deliveries delivery
         INNER JOIN material_requests request ON request.id = delivery.request_id
         WHERE request.material_id IN (${ids})`,
        materialIds,
      )
      await pool.query(`DELETE FROM material_requests WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM material_matches WHERE material_id IN (${ids})`, materialIds)
      await pool.query(`DELETE FROM materials WHERE id IN (${ids})`, materialIds)
      for (const row of imageRows) {
        if (typeof row.storage_key === 'string') {
          await removeMaterialFile(row.storage_key)
        }
      }
    }
  }
  await pool.query(`DELETE FROM organization_invitations WHERE email IN (${placeholders})`, createdEmails)
  if (userIds.length > 0) {
    const users = userIds.map(() => '?').join(', ')
    await pool.query(`DELETE FROM organization_invitations WHERE invited_by_user_id IN (${users})`, userIds)
    await pool.query(`DELETE FROM sessions WHERE user_id IN (${users})`, userIds)
    await pool.query(`DELETE FROM organization_members WHERE user_id IN (${users})`, userIds)
  }
  await pool.query(
    `DELETE FROM organizations
     WHERE contact_email IN (${placeholders})
       AND id NOT IN (SELECT organization_id FROM organization_members)`,
    createdEmails,
  )
  await pool.query(`DELETE FROM users WHERE email IN (${placeholders})`, createdEmails)
  await pool.query(
    `DELETE FROM login_attempts WHERE email_hash IN (${createdEmails.map(() => '?').join(', ')})`,
    createdEmails.map((value) => sha256(value)),
  )
  await closePool()
})

test('rechaza inventario sin sesión, cantidades inválidas y catálogos inexistentes', async () => {
  const anonymous = await call('GET', '/api/materials', new Jar())
  assert.equal(anonymous.status, 401)
  assert.equal(errorOf(anonymous.body).code, 'UNAUTHENTICATED')

  const jar = new Jar()
  const address = email('alta')
  await register(jar, address)
  const organizationId = await createOrganization(jar, address, 'Taller de inventario')
  const { categoryId, unitId } = await catalog(jar)
  const withoutCsrf = await call('POST', '/api/materials', jar, materialBody(organizationId, categoryId, unitId, 'Sin verificación'), false)
  assert.equal(withoutCsrf.status, 403)
  assert.equal(errorOf(withoutCsrf.body).code, 'CSRF_REJECTED')

  for (const quantity of [0, -3, '0.000']) {
    const rejected = await call('POST', '/api/materials', jar, materialBody(organizationId, categoryId, unitId, 'Cantidad inválida', quantity))
    assert.equal(rejected.status, 400)
    assert.equal(errorOf(rejected.body).code, 'INVALID_INPUT')
  }
  const badCategory = await call('POST', '/api/materials', jar, materialBody(organizationId, 999999999, unitId, 'Categoría ajena'))
  assert.equal(badCategory.status, 400)
  assert.equal(errorOf(badCategory.body).code, 'INVALID_REFERENCE')
  const badUnit = await call('POST', '/api/materials', jar, materialBody(organizationId, categoryId, 999999999, 'Unidad ajena'))
  assert.equal(badUnit.status, 400)
  assert.equal(errorOf(badUnit.body).code, 'INVALID_REFERENCE')
  const badQuery = await call('GET', '/api/materials?sort=id;drop&pageSize=500', jar)
  assert.equal(badQuery.status, 400)
})

test('crea, lista, aísla y pagina materiales de la organización', async () => {
  const owner = new Jar()
  const ownerEmail = email('lista')
  await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail, 'Acopio norte')
  const { categoryId, unitId } = await catalog(owner)
  const marker = `Viga fase5 ${Date.now()}`
  const created = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, marker, '10'))
  assert.equal(created.status, 201)
  const material = materialOf(created.body)
  assert.match(String(material.code), /^MAT-\d{6,}$/)
  assert.equal(material.technicalValidationStatus, 'pending')
  assert.equal(JSON.stringify(material).includes('storage_key'), false)
  assert.equal('publicCode' in material, false)
  assert.equal(Number(material.availableQuantity), 10)

  const second = await call(
    'POST',
    '/api/materials',
    owner,
    materialBody(organizationId, categoryId, unitId, `${marker} complemento`, '2', { availabilityStatus: 'draft', city: 'Envigado' }),
  )
  assert.equal(second.status, 201)

  const page = await call('GET', `/api/materials?q=${encodeURIComponent(marker)}&pageSize=1&page=1&organizationId=${organizationId}`, owner)
  assert.equal(page.status, 200)
  const listed = dataOf(page.body)
  assert.equal(listed.total, 2)
  assert.ok(Array.isArray(listed.materials))
  assert.equal(listed.materials.length, 1)
  const next = await call('GET', `/api/materials?q=${encodeURIComponent(marker)}&pageSize=1&page=2&organizationId=${organizationId}`, owner)
  const nextItems = dataOf(next.body).materials
  assert.ok(Array.isArray(listed.materials) && Array.isArray(nextItems))
  assert.notEqual(listed.materials[0] && isRecord(listed.materials[0]) ? listed.materials[0].id : 0, isRecord(nextItems[0]) ? nextItems[0].id : 0)

  const byCity = await call('GET', `/api/materials?q=${encodeURIComponent('Envigado')}&organizationId=${organizationId}`, owner)
  assert.equal(dataOf(byCity.body).total, 1)
  const byStatus = await call('GET', `/api/materials?status=published&q=${encodeURIComponent(marker)}&organizationId=${organizationId}`, owner)
  assert.equal(dataOf(byStatus.body).total, 1)
  const literalPercent = await call('GET', `/api/materials?q=${encodeURIComponent('%')}&organizationId=${organizationId}`, owner)
  assert.equal(dataOf(literalPercent.body).total, 0)

  const stranger = new Jar()
  const strangerEmail = email('ajena')
  await register(stranger, strangerEmail)
  const hidden = await call('GET', `/api/materials/${Number(material.id)}`, stranger)
  assert.equal(hidden.status, 404)
  const foreignCreate = await call('POST', '/api/materials', stranger, materialBody(organizationId, categoryId, unitId, 'No debe crearse'))
  assert.equal(foreignCreate.status, 404)
  const strangerList = await call('GET', `/api/materials?organizationId=${organizationId}`, stranger)
  assert.equal(dataOf(strangerList.body).total, 0)
})

test('edita con permiso, rechaza ajenos y no toca campos protegidos', async () => {
  const owner = new Jar()
  const ownerEmail = email('edicion')
  const ownerId = await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail, 'Acopio edición')
  const { categoryId, unitId } = await catalog(owner)
  const created = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, 'Bloque editable', '6'))
  const materialId = Number(materialOf(created.body).id)

  const viewer = new Jar()
  const viewerEmail = email('consulta')
  const viewerId = await register(viewer, viewerEmail)
  const editor = new Jar()
  const editorEmail = email('editor')
  const editorId = await register(editor, editorEmail)
  const { getPool } = await import('../../config/database.js')
  await getPool().query(
    `INSERT INTO organization_members (organization_id, user_id, role, membership_status) VALUES (?, ?, 'viewer', 'active'), (?, ?, 'editor', 'active')`,
    [organizationId, viewerId, organizationId, editorId],
  )
  assert.ok(ownerId > 0)

  const viewed = await call('GET', `/api/materials/${materialId}`, viewer)
  assert.equal(viewed.status, 200)
  assert.equal(materialOf(viewed.body).canEdit, false)
  const denied = await call('PATCH', `/api/materials/${materialId}`, viewer, { title: 'Cambio no permitido' })
  assert.equal(denied.status, 403)
  assert.equal(errorOf(denied.body).code, 'FORBIDDEN')

  const edited = await call('PATCH', `/api/materials/${materialId}`, editor, { title: 'Bloque corregido', city: 'Bello' })
  assert.equal(edited.status, 200)
  assert.equal(materialOf(edited.body).title, 'Bloque corregido')
  assert.equal(materialOf(edited.body).technicalValidationStatus, 'pending')

  const protectedField = await call('PATCH', `/api/materials/${materialId}`, editor, {
    title: 'No debe aplicarse',
    technicalValidationStatus: 'suitable_for_stated_use',
  })
  assert.equal(protectedField.status, 400)
  const current = await call('GET', `/api/materials/${materialId}`, owner)
  assert.equal(materialOf(current.body).title, 'Bloque corregido')
  assert.equal(materialOf(current.body).technicalValidationStatus, 'pending')

  const outsider = new Jar()
  await register(outsider, email('fuera'))
  const missing = await call('PATCH', `/api/materials/${materialId}`, outsider, { title: 'Intento ajeno' })
  assert.equal(missing.status, 404)
})

test('la cantidad no baja de lo comprometido y el archivo no borra el historial', async () => {
  const owner = new Jar()
  const ownerEmail = email('cantidad')
  await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail, 'Acopio cantidades')
  const { categoryId, unitId } = await catalog(owner)
  const created = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, 'Acero comprometido', '10'))
  const materialId = Number(materialOf(created.body).id)
  const { getPool } = await import('../../config/database.js')
  const pool = getPool()
  await pool.query(
    `INSERT INTO material_requests (material_id, requesting_organization_id, requested_quantity, status)
     VALUES (?, ?, 4, 'accepted')`,
    [materialId, organizationId],
  )
  const detail = await call('GET', `/api/materials/${materialId}`, owner)
  assert.equal(Number(materialOf(detail.body).availableQuantity), 6)
  assert.equal(Number(materialOf(detail.body).committedQuantity), 4)

  const tooLow = await call('PATCH', `/api/materials/${materialId}`, owner, { quantity: '3' })
  assert.equal(tooLow.status, 409)
  assert.equal(errorOf(tooLow.body).code, 'QUANTITY_BELOW_COMMITMENT')
  const covered = await call('PATCH', `/api/materials/${materialId}`, owner, { quantity: '4' })
  assert.equal(covered.status, 200)
  assert.equal(Number(materialOf(covered.body).availableQuantity), 0)

  let mapped: unknown
  try {
    await pool.query('UPDATE materials SET quantity = 0 WHERE id = ?', [materialId])
    assert.fail('MySQL debió rechazar la cantidad cero.')
  } catch (error) {
    try {
      mapDatabaseError(error)
    } catch (caught) {
      mapped = caught
    }
  }
  assert.ok(mapped instanceof AppError)
  assert.equal(mapped.code, 'INVALID_INPUT')
  const stillThere = await call('GET', `/api/materials/${materialId}`, owner)
  assert.equal(Number(materialOf(stillThere.body).quantity), 4)

  const archived = await call('PATCH', `/api/materials/${materialId}/status`, owner, { availabilityStatus: 'withdrawn' })
  assert.equal(archived.status, 200)
  assert.equal(materialOf(archived.body).availabilityStatus, 'withdrawn')
  const removed = await call('DELETE', `/api/materials/${materialId}`, owner)
  assert.equal(removed.status, 404)
  await assert.rejects(() => pool.query('DELETE FROM materials WHERE id = ?', [materialId]))
  const preserved = await call('GET', `/api/materials/${materialId}`, owner)
  assert.equal(preserved.status, 200)
})

test('las imágenes se validan, se aíslan y tienen un límite', async () => {
  const owner = new Jar()
  const ownerEmail = email('imagen')
  await register(owner, ownerEmail)
  const organizationId = await createOrganization(owner, ownerEmail, 'Acopio imágenes')
  const { categoryId, unitId } = await catalog(owner)
  const created = await call('POST', '/api/materials', owner, materialBody(organizationId, categoryId, unitId, 'Material con foto', '1'))
  const materialId = Number(materialOf(created.body).id)

  async function upload(jar: Jar, bytes: Buffer, name: string, type: string) {
    const form = new FormData()
    form.set('image', new File([new Uint8Array(bytes)], name, { type }))
    const headers = new Headers({ Accept: 'application/json', cookie: jar.header(), 'x-csrf-token': jar.csrf() })
    const response = await fetch(`${baseUrl}/api/materials/${materialId}/images`, { method: 'POST', headers, body: form })
    jar.store(response)
    const payload: unknown = await response.json()
    assert.ok(isRecord(payload))
    return { status: response.status, body: payload }
  }

  const fake = await upload(owner, Buffer.from('no es una imagen'), 'foto.png', 'image/png')
  assert.equal(fake.status, 400)
  assert.equal(errorOf(fake.body).code, 'INVALID_INPUT')

  const stored = await upload(owner, png, 'foto.png', 'image/png')
  assert.equal(stored.status, 201)
  const image = dataOf(stored.body).image
  assert.ok(isRecord(image))
  assert.equal(JSON.stringify(image).includes('storage'), false)
  const imageId = Number(image.id)

  const response = await fetch(`${baseUrl}/api/materials/${materialId}/images/${imageId}`, {
    headers: { cookie: owner.header() },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^image\/png/)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(bytes.equals(png), true)

  const stranger = new Jar()
  await register(stranger, email('imagen-ajena'))
  const hidden = await fetch(`${baseUrl}/api/materials/${materialId}/images/${imageId}`, {
    headers: { cookie: stranger.header() },
  })
  assert.equal(hidden.status, 404)

  for (let index = 0; index < 5; index += 1) {
    const extra = await upload(owner, png, `extra-${index}.png`, 'image/png')
    assert.equal(extra.status, 201)
  }
  const limited = await upload(owner, png, 'extra-final.png', 'image/png')
  assert.equal(limited.status, 400)
  assert.equal(errorOf(limited.body).code, 'IMAGE_LIMIT')

  const removedImage = await call('DELETE', `/api/materials/${materialId}/images/${imageId}`, owner)
  assert.equal(removedImage.status, 200)
  const gone = await fetch(`${baseUrl}/api/materials/${materialId}/images/${imageId}`, {
    headers: { cookie: owner.header() },
  })
  assert.equal(gone.status, 404)
})
