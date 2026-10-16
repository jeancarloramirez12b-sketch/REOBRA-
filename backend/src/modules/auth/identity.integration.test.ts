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
const otherPassword = 'otra-clave-larga'

let app: Express
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

  clear(): void {
    this.values.clear()
  }

  absorb(header: string): void {
    this.values.clear()
    for (const part of header.split('; ')) {
      const index = part.indexOf('=')
      if (index > 0) {
        this.values.set(part.slice(0, index), part.slice(index + 1))
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function email(label: string): string {
  const value = `fase4-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@reobra.test`
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

function errorOf(body: Record<string, unknown>): { code: string; message: string } {
  assert.equal(body.success, false)
  assert.ok(isRecord(body.error))
  return { code: String(body.error.code), message: String(body.error.message) }
}

async function register(jar: Jar, address: string, fullName = 'Persona de prueba'): Promise<Record<string, unknown>> {
  const result = await call('POST', '/api/auth/register', jar, {
    fullName,
    email: address,
    password,
    acceptedTerms: true,
  })
  assert.equal(result.status, 201)
  return dataOf(result.body)
}

before(async () => {
  await import('../../config/env.js')
  const { readDatabaseConfig, closePool } = await import('../../config/database.js')
  if (readDatabaseConfig().database !== 'reobra') {
    throw new Error('Las pruebas de identidad usan la base reobra y solo borran correos fase4-…@reobra.test.')
  }

  const { migrateUp } = await import('../../database/migrator.js')
  await migrateUp()
  await closePool()

  const { createApp } = await import('../../app.js')
  const { getConfig } = await import('../../config/env.js')
  app = createApp(getConfig())
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
  if (!ready) {
    return
  }
  await import('../../config/env.js')
  const { getPool, closePool } = await import('../../config/database.js')
  const { sha256 } = await import('./tokens.js')
  const pool = getPool()
  const [rows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name')
  if (rows[0]?.name !== 'reobra') {
    throw new Error('Se evitó limpiar una base distinta de reobra.')
  }
  if (createdEmails.length > 0) {
    const hashes = createdEmails.map((value) => sha256(value))
    const userRows = await pool.query<RowDataPacket[]>(
      `SELECT id FROM users WHERE email IN (${createdEmails.map(() => '?').join(', ')})`,
      createdEmails,
    )
    const userIds = userRows[0].map((row) => Number(row.id))
    await pool.query(
      `DELETE FROM organization_invitations WHERE email IN (${createdEmails.map(() => '?').join(', ')})`,
      createdEmails,
    )
    if (userIds.length > 0) {
      const userPlaceholders = userIds.map(() => '?').join(', ')
      await pool.query(`DELETE FROM organization_invitations WHERE invited_by_user_id IN (${userPlaceholders})`, userIds)
      await pool.query(`DELETE FROM sessions WHERE user_id IN (${userPlaceholders})`, userIds)
      await pool.query(`DELETE FROM organization_members WHERE user_id IN (${userPlaceholders})`, userIds)
    }
    await pool.query(
      `DELETE FROM organizations
       WHERE contact_email IN (${createdEmails.map(() => '?').join(', ')})
         AND id NOT IN (SELECT organization_id FROM organization_members)`,
      createdEmails,
    )
    await pool.query(`DELETE FROM users WHERE email IN (${createdEmails.map(() => '?').join(', ')})`, createdEmails)
    await pool.query(
      `DELETE FROM login_attempts WHERE email_hash IN (${hashes.map(() => '?').join(', ')})`,
      hashes,
    )
  }
  await closePool()
})

test('el registro valida entrada, rechaza duplicados y no devuelve secretos', async () => {
  const jar = new Jar()
  const invalid = await call('POST', '/api/auth/register', jar, {
    fullName: 'Persona',
    email: 'correo-invalido',
    password,
    acceptedTerms: true,
  })
  assert.equal(invalid.status, 400)
  assert.equal(errorOf(invalid.body).code, 'INVALID_INPUT')

  const weak = await call('POST', '/api/auth/register', jar, {
    fullName: 'Persona',
    email: email('debil'),
    password: 'corta',
    acceptedTerms: true,
  })
  assert.equal(weak.status, 400)
  assert.equal(errorOf(weak.body).code, 'WEAK_PASSWORD')

  const address = email('alta')
  const created = await register(jar, address)
  const serialized = JSON.stringify(created)
  assert.equal(serialized.includes(password), false)
  assert.equal(serialized.includes('argon2'), false)
  assert.ok(isRecord(created.user))
  assert.equal(created.user.email, address)
  assert.equal(jar.csrf().length > 20, true)

  const duplicate = await call('POST', '/api/auth/register', new Jar(), {
    fullName: 'Otra persona',
    email: address.toUpperCase(),
    password: otherPassword,
    acceptedTerms: true,
  })
  assert.equal(duplicate.status, 409)
  assert.equal(errorOf(duplicate.body).code, 'EMAIL_IN_USE')

  const { getPool } = await import('../../config/database.js')
  const [stored] = await getPool().query<RowDataPacket[]>(
    'SELECT password_hash FROM users WHERE email = ?',
    [address],
  )
  const hash = String(stored[0]?.password_hash)
  assert.match(hash, /^\$argon2id\$/)
  assert.equal(hash.includes(password), false)
})

test('la sesión se mantiene, se cierra y no vuelve a autorizar', async () => {
  const jar = new Jar()
  const address = email('sesion')
  await register(jar, address)
  const me = await call('GET', '/api/auth/me', jar)
  assert.equal(me.status, 200)
  const sessionUser = dataOf(me.body).user
  assert.ok(isRecord(sessionUser))
  assert.equal(sessionUser.email, address)

  const missing = await call('GET', '/api/organizations', new Jar())
  assert.equal(missing.status, 401)

  const withoutCsrf = await call('POST', '/api/auth/logout', jar, {}, false)
  assert.equal(withoutCsrf.status, 403)
  assert.equal(errorOf(withoutCsrf.body).code, 'CSRF_REJECTED')
  const stillThere = await call('GET', '/api/auth/me', jar)
  assert.equal(stillThere.status, 200)

  const logout = await call('POST', '/api/auth/logout', jar, {})
  assert.equal(logout.status, 200)
  const denied = await call('GET', '/api/users/me', jar)
  assert.equal(denied.status, 401)
})

test('login usa el mismo mensaje para correo inexistente y contraseña incorrecta', async () => {
  const address = email('login')
  await register(new Jar(), address)
  const unknown = await call('POST', '/api/auth/login', new Jar(), {
    email: email('nadie'),
    password: otherPassword,
  })
  const wrong = await call('POST', '/api/auth/login', new Jar(), {
    email: address,
    password: otherPassword,
  })
  assert.equal(unknown.status, 401)
  assert.equal(wrong.status, 401)
  assert.equal(errorOf(unknown.body).message, errorOf(wrong.body).message)
  assert.equal(errorOf(unknown.body).message.includes(address), false)

  const jar = new Jar()
  const ok = await call('POST', '/api/auth/login', jar, { email: address, password })
  assert.equal(ok.status, 200)
  assert.equal(jar.header().includes('reobra_session='), true)
})

test('el perfil se actualiza sin campos sensibles y la contraseña rota la sesión', async () => {
  const jar = new Jar()
  const address = email('perfil')
  await register(jar, address, 'Nombre inicial')

  const forbidden = await call('PATCH', '/api/users/me', jar, {
    fullName: 'Nombre nuevo',
    email: email('otro'),
  })
  assert.equal(forbidden.status, 400)

  const updated = await call('PATCH', '/api/users/me', jar, {
    fullName: 'Nombre actualizado',
    phone: '3001234567',
  })
  assert.equal(updated.status, 200)
  const user = dataOf(updated.body).user
  assert.ok(isRecord(user))
  assert.equal(user.fullName, 'Nombre actualizado')
  assert.equal(user.email, address)
  assert.equal(JSON.stringify(updated.body).includes('password'), false)

  const badCurrent = await call('POST', '/api/auth/change-password', jar, {
    currentPassword: otherPassword,
    newPassword: otherPassword,
  })
  assert.equal(badCurrent.status, 400)

  const oldCookie = jar.header()
  const changed = await call('POST', '/api/auth/change-password', jar, {
    currentPassword: password,
    newPassword: otherPassword,
  })
  assert.equal(changed.status, 200)
  assert.notEqual(jar.header(), oldCookie)
  const me = await call('GET', '/api/auth/me', jar)
  assert.equal(me.status, 200)

  const oldJar = new Jar()
  oldJar.absorb(oldCookie)
  const revoked = await call('GET', '/api/auth/me', oldJar)
  assert.equal(revoked.status, 401)

  const previous = await call('POST', '/api/auth/login', new Jar(), { email: address, password })
  assert.equal(previous.status, 401)
  const next = await call('POST', '/api/auth/login', new Jar(), { email: address, password: otherPassword })
  assert.equal(next.status, 200)
})

test('una sesión vencida no autoriza', async () => {
  const jar = new Jar()
  const address = email('vence')
  await register(jar, address)
  const { getPool } = await import('../../config/database.js')
  await getPool().query(
    `UPDATE sessions
     SET created_at = DATE_SUB(NOW(3), INTERVAL 2 HOUR),
         expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE)
     WHERE user_id = (SELECT id FROM users WHERE email = ?)`,
    [address],
  )
  const expired = await call('GET', '/api/auth/me', jar)
  assert.equal(expired.status, 401)
  assert.equal(errorOf(expired.body).code, 'SESSION_EXPIRED')
})

test('las organizaciones quedan aisladas y el último responsable no puede irse', async () => {
  const ownerJar = new Jar()
  const ownerEmail = email('duena')
  await register(ownerJar, ownerEmail, 'Dueña de prueba')
  const created = await call('POST', '/api/organizations', ownerJar, {
    name: 'Organización de prueba',
    organizationType: 'company',
    contactEmail: ownerEmail,
    city: 'Bogotá',
    department: 'Bogotá D.C.',
    country: 'co',
  })
  assert.equal(created.status, 201)
  const organization = dataOf(created.body).organization
  assert.ok(isRecord(organization))
  assert.equal(organization.verificationStatus, 'unverified')
  assert.ok(isRecord(organization.membership))
  assert.equal(organization.membership.role, 'owner')
  const organizationId = Number(organization.id)

  const listed = await call('GET', '/api/organizations', ownerJar)
  const organizations = dataOf(listed.body).organizations
  assert.ok(Array.isArray(organizations))
  assert.equal(organizations.length, 1)

  const stranger = new Jar()
  await register(stranger, email('ajena'), 'Persona ajena')
  const hidden = await call('GET', `/api/organizations/${organizationId}`, stranger)
  assert.equal(hidden.status, 404)
  const hiddenMembers = await call('GET', `/api/organizations/${organizationId}/members`, stranger)
  assert.equal(hiddenMembers.status, 404)

  const leaving = await call(
    'DELETE',
    `/api/organizations/${organizationId}/members/${Number(organization.membership.id)}`,
    ownerJar,
  )
  assert.equal(leaving.status, 409)
  assert.equal(errorOf(leaving.body).code, 'LAST_OWNER')

  const viewerJar = new Jar()
  const viewerEmail = email('consulta')
  await register(viewerJar, viewerEmail, 'Persona consulta')
  const invitation = await call('POST', `/api/organizations/${organizationId}/invitations`, ownerJar, {
    email: viewerEmail,
    role: 'viewer',
  })
  assert.equal(invitation.status, 201)
  const token = String(dataOf(invitation.body).token)
  assert.equal(token.length > 20, true)
  assert.equal(JSON.stringify(dataOf(invitation.body).invitation).includes(token), false)

  const accepted = await call('POST', '/api/invitations/accept', viewerJar, { token })
  assert.equal(accepted.status, 200)
  const reused = await call('POST', '/api/invitations/accept', viewerJar, { token })
  assert.equal(reused.status, 409)
  assert.equal(errorOf(reused.body).code, 'INVITATION_USED')

  const viewerEdit = await call('PATCH', `/api/organizations/${organizationId}`, viewerJar, {
    name: 'Cambio no permitido',
  })
  assert.equal(viewerEdit.status, 403)

  const adminJar = new Jar()
  const adminEmail = email('admin')
  await register(adminJar, adminEmail, 'Persona administradora')
  const adminInvite = await call('POST', `/api/organizations/${organizationId}/invitations`, ownerJar, {
    email: adminEmail,
    role: 'administrator',
  })
  const adminToken = String(dataOf(adminInvite.body).token)
  await call('POST', '/api/invitations/accept', adminJar, { token: adminToken })

  const escalation = await call('POST', `/api/organizations/${organizationId}/invitations`, adminJar, {
    email: email('escalada'),
    role: 'administrator',
  })
  assert.equal(escalation.status, 403)

  const members = dataOf((await call('GET', `/api/organizations/${organizationId}/members`, ownerJar)).body).members
  assert.ok(Array.isArray(members))
  const ownerMember = members.find((item) => isRecord(item) && item.role === 'owner')
  assert.ok(isRecord(ownerMember))
  const promote = await call('PATCH', `/api/organizations/${organizationId}/members/${Number(ownerMember.id)}`, adminJar, {
    role: 'viewer',
  })
  assert.equal(promote.status, 403)

  const guest = new Jar()
  const guestEmail = email('invitada')
  await register(guest, guestEmail, 'Persona invitada')
  const pending = await call('POST', `/api/organizations/${organizationId}/invitations`, ownerJar, {
    email: guestEmail,
    role: 'editor',
  })
  const pendingBody = dataOf(pending.body)
  const pendingId = Number(isRecord(pendingBody.invitation) ? pendingBody.invitation.id : 0)
  const pendingToken = String(pendingBody.token)
  const revoked = await call('POST', `/api/organizations/${organizationId}/invitations/${pendingId}/revoke`, ownerJar, {})
  assert.equal(revoked.status, 200)
  const afterRevoke = await call('POST', '/api/invitations/accept', guest, { token: pendingToken })
  assert.equal(afterRevoke.status, 409)
  assert.equal(errorOf(afterRevoke.body).code, 'INVITATION_REVOKED')

  const mismatch = await call('POST', `/api/organizations/${organizationId}/invitations`, ownerJar, {
    email: guestEmail,
    role: 'editor',
  })
  const mismatchData = dataOf(mismatch.body)
  const mismatchToken = String(mismatchData.token)
  const wrongPerson = await call('POST', '/api/invitations/accept', stranger, { token: mismatchToken })
  assert.equal(wrongPerson.status, 403)
  const mismatchId = Number(isRecord(mismatchData.invitation) ? mismatchData.invitation.id : 0)
  await call('POST', `/api/organizations/${organizationId}/invitations/${mismatchId}/revoke`, ownerJar, {})

  const expiring = await call('POST', `/api/organizations/${organizationId}/invitations`, ownerJar, {
    email: guestEmail,
    role: 'editor',
  })
  const expiringBody = dataOf(expiring.body)
  const expiringId = Number(isRecord(expiringBody.invitation) ? expiringBody.invitation.id : 0)
  const { getPool } = await import('../../config/database.js')
  await getPool().query(
    `UPDATE organization_invitations
     SET created_at = DATE_SUB(NOW(3), INTERVAL 10 DAY),
         expires_at = DATE_SUB(NOW(3), INTERVAL 1 DAY)
     WHERE id = ?`,
    [expiringId],
  )
  const expired = await call('POST', '/api/invitations/accept', guest, { token: String(expiringBody.token) })
  assert.equal(expired.status, 409)
  assert.equal(errorOf(expired.body).code, 'INVITATION_EXPIRED')
})

test('demasiados intentos de una misma cuenta reciben 429', async () => {
  const address = email('limite')
  await register(new Jar(), address)
  let status = 0
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await call('POST', '/api/auth/login', new Jar(), {
      email: address,
      password: otherPassword,
    })
    status = result.status
    assert.equal(status, 401)
  }
  const limited = await call('POST', '/api/auth/login', new Jar(), {
    email: address,
    password: otherPassword,
  })
  assert.equal(limited.status, 429)
  assert.equal(errorOf(limited.body).code, 'TOO_MANY_ATTEMPTS')
  assert.equal(JSON.stringify(limited.body).includes(password), false)
})
